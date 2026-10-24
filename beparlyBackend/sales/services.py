from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from django.db import transaction
from django.core.files.storage import default_storage
from django.utils.dateparse import parse_date

from accounting.models import Contact, IncomeCategory, JournalEntry, LedgerAccount, MoneyAccount, MoneyTransaction
from accounting.services import AccountingError, amount, cr, dr, ledger, post, create_financial_category, ensure_party_accounts
from accounts.models import Business
from audit.services import record
from products.models import Product, ProductUnit, StockBatch
from stockkeeper.models import CostLayer, StockBalance, StockMovement
from stockkeeper.services import (StockError, business_today, consume, normalize_quantity,
                                  resolve_variant, validate_batch, validate_location)

from .models import Sale, SaleLine, SalePayment, SaleReturn, SaleReturnLine, SaleSequence


class SaleError(ValueError):
    pass


def create_sale(business, actor, command_id, data, *, quotation=None):
    with transaction.atomic():
        Business.objects.select_for_update().get(pk=business.pk)
        prior = Sale.objects.filter(business=business, command_id=command_id).first()
        if prior:
            return prior
        if data.get('mode') not in ('quick', 'manual'):
            raise SaleError('Choose Quick Sale or Manual Sale.')
        mode = data['mode']
        tier = 'retail' if mode == 'quick' else data.get('price_tier')
        if tier not in ('retail', 'wholesale'):
            raise SaleError('Choose retail or wholesale pricing.')
        location = validate_location(business.pk, data.get('location_id'))
        if not location.address.strip():
            raise SaleError('Add the billing address for this shop in More → Shops & locations before recording a sale.')
        contact = Contact.objects.filter(business=business, pk=data.get('customer_id'), is_customer=True, is_active=True).first() if data.get('customer_id') else None
        if data.get('customer_id') and not contact:
            raise SaleError('Choose an active customer in this business.')
        guest_sale = contact is None
        if contact is None:
            contact, _ = Contact.objects.get_or_create(business=business, name='Walk-in Customer', is_customer=True,
                                                        defaults={'is_supplier': False, 'phone': ''})
        contact = ensure_party_accounts(contact)
        requested_category = data.get('income_category_id')
        category = IncomeCategory.objects.filter(
            business=business, pk=requested_category, ledger_account__is_active=True,
            ledger_account__type='income').select_related('ledger_account').first() if requested_category else None
        if category and (category.ledger_account.code == 'MISC_INCOME'
                         or category.name.casefold() == 'miscellaneous income'):
            raise SaleError('Choose a sales income category.')
        if not category:
            category = IncomeCategory.objects.filter(
                business=business, name__iexact='Sales', ledger_account__is_active=True,
                ledger_account__type='income').select_related('ledger_account').order_by('pk').first()
        if not category:
            category = create_financial_category(business, actor, 'Sales', 'income')
        raw_lines = data.get('lines')
        if not isinstance(raw_lines, list) or not raw_lines or len(raw_lines) > 100:
            raise SaleError('Add at least one product to the sale.')
        money = None
        paid = amount(data.get('paid', '0'), positive=False)
        if paid:
            money = MoneyAccount.objects.filter(business=business, pk=data.get('account_id'), is_active=True).select_related('ledger_account').first()
            if not money:
                raise SaleError('Choose an active payment account.')

        quoted_lines = list(quotation.lines.order_by('pk')) if quotation else []
        if quotation and (quotation.business_id != business.pk or quotation.status != 'accepted' or len(raw_lines) != len(quoted_lines)):
            raise SaleError('Quotation checkout is unavailable.')
        prepared, subtotal = [], Decimal('0')
        for index, item in enumerate(raw_lines):
            product = Product.objects.filter(business=business, pk=item.get('product_id'), is_active=True).first()
            if not product:
                raise SaleError('A product is unavailable or belongs to another business.')
            variant = resolve_variant(product, item.get('variant_id'))
            unit = ProductUnit.objects.filter(product=product, variant=variant, pk=item.get('unit_id'), is_active=True).first() if item.get('unit_id') else None
            if item.get('unit_id') and not unit:
                raise SaleError('Choose an active unit for this product.')
            quantity = amount(item.get('quantity'), places=3)
            base, factor, unit_name = normalize_quantity(variant, quantity, unit.pk if unit else None)
            quoted = quoted_lines[index] if quotation else None
            if quoted and (quoted.product_id != product.pk or quoted.variant_id != variant.pk or
                           quoted.unit_id != (unit.pk if unit else None) or quoted.quantity != quantity or
                           quoted.conversion_factor != factor):
                raise SaleError('Quoted product or package changed. Duplicate and revise the quotation.')
            price = unit.selling_price if unit and unit.selling_price is not None else getattr(variant, f'{tier}_price')
            if price is None and quoted:
                price = quoted.unit_price
            if price is None:
                raise SaleError(f'Add a {tier} price for {product.name}.')
            price = amount(item.get('unit_price', quoted.unit_price) if quoted else price)
            if quoted and price != quoted.unit_price:
                from accounts.models import BusinessMember
                if not BusinessMember.objects.filter(business=business, user=actor, role=BusinessMember.OWNER).exists():
                    raise SaleError('Only the owner may revise a quoted price at checkout.')
            batch = StockBatch.objects.filter(product=product, variant=variant, pk=item.get('batch_id')).first() if item.get('batch_id') else None
            validate_batch(variant, batch)
            if batch and variant.tracking_mode == 'expiry' and batch.expires_on and batch.expires_on < business_today(business):
                raise SaleError('Expired stock cannot be sold.')
            line_total = (quantity * price).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            subtotal += line_total
            prepared.append((product, variant, batch, quantity, base, factor, unit_name, price, line_total))
        raw_discount = data.get('discount', '0')
        discount = amount(raw_discount, positive=False)
        if data.get('discount_type') == 'percent':
            if discount > 100:
                raise SaleError('Discount percentage cannot exceed 100%.')
            discount = (subtotal * discount / 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        elif data.get('discount_type', 'amount') != 'amount':
            raise SaleError('Choose an amount or percentage discount.')
        if discount > subtotal:
            raise SaleError('Discount cannot exceed the sale subtotal.')
        if discount == subtotal:
            raise SaleError('A sale must have a positive product amount after discount.')
        delivery_fee = amount(data.get('delivery_fee', '0'), positive=False)
        raw_delivery_address = data.get('delivery_address') or ''
        if isinstance(raw_delivery_address, dict):
            raw_delivery_address = raw_delivery_address.get('text') or ''
        if not isinstance(raw_delivery_address, str):
            raise SaleError('Enter a valid delivery address.')
        delivery_address = raw_delivery_address.strip()
        if delivery_fee and not delivery_address:
            raise SaleError('Add a delivery address when charging for delivery.')
        if len(delivery_address) > 500:
            raise SaleError('Delivery address must be 500 characters or fewer.')
        total = subtotal - discount + delivery_fee
        if total <= 0:
            raise SaleError('Sale total must be greater than zero.')
        if paid > total:
            raise SaleError('Payment cannot exceed the sale total.')
        if total > paid and (guest_sale or not contact or not contact.is_customer):
            raise SaleError('A customer is required when any amount will remain due.')

        # Business row serializes all checkouts and sequence increments; stock rows and FIFO layers are locked too.
        sequence, _ = SaleSequence.objects.select_for_update().get_or_create(business=business)
        sequence.value += 1
        sequence.save(update_fields=['value'])
        invoice_date = parse_date(str(data.get('invoice_date'))) if data.get('invoice_date') else business_today(business)
        if data.get('invoice_date') and not invoice_date:
            raise SaleError('Invoice date must be a valid date.')
        sale = Sale.objects.create(business=business, invoice_number=f'S-{sequence.value:03d}', customer=contact,
            quotation=quotation, customer_name_snapshot=(quotation.customer_name if quotation and quotation.customer_id == (None if guest_sale else contact.pk) else contact.name) or 'Walk-in Customer',
            customer_phone_snapshot=quotation.customer_phone if quotation and quotation.customer_id == (None if guest_sale else contact.pk) else contact.phone,
            customer_address_snapshot={'address': quotation.customer_address} if quotation and quotation.customer_id == (None if guest_sale else contact.pk) else {'address': contact.address, 'district': contact.district, 'area': contact.area},
            location=location, income_category=category, actor=actor, command_id=command_id, mode=mode,
            price_tier=tier, subtotal=subtotal, discount=discount, delivery_fee=delivery_fee, total=total, paid=Decimal('0'),
            payment_status='due', billing_address={'text': location.address.strip(), 'location_id': str(location.pk)},
            delivery_address={'text': delivery_address} if delivery_address else {}, source=str(data.get('source') or '').strip()[:80],
            notes=str(data.get('notes') or '').strip()[:2000], invoice_date=invoice_date)
        from accounting.services import ensure_inventory_cutoff
        ensure_inventory_cutoff(business)
        cost = Decimal('0')
        for index, (product, variant, batch, quantity, base, factor, unit_name, price, line_total) in enumerate(prepared):
            balance = StockBalance.objects.select_for_update().filter(business=business, variant=variant, location=location, batch=batch).first()
            if not balance or balance.quantity < base:
                raise StockError(f'Insufficient stock for {product.name} at {location.name}.')
            line_cost, portions = consume(product, variant, location, base, batch)
            cost += line_cost
            quoted = quoted_lines[index] if quotation else None
            SaleLine.objects.create(sale=sale, product=product, variant=variant, batch=batch,
                product_name=quoted.product_name if quoted else product.name, variant_name=quoted.variant_name if quoted else variant.label,
                image_url_snapshot=quoted.image_url_snapshot if quoted else (default_storage.url(product.image_key) if product.image_key else ''),
                sku=quoted.sku if quoted else variant.sku, unit_name=quoted.unit_name if quoted else unit_name,
                conversion_factor=factor, quantity=quantity, base_quantity=base, unit_price=price,
                line_total=line_total, inventory_cost=line_cost,
                cost_layers=[{'quantity': str(portion_qty), 'unit_cost': str(unit_cost)} for portion_qty, unit_cost in portions])
            movement = StockMovement.objects.create(business=business, product=product, variant=variant,
                location=location, batch=batch, type='sale', quantity_change=-base, inventory_cost=-line_cost,
                unit_name=unit_name, conversion_factor=factor, reason=f'Sale {sale.invoice_number}',
                reference_id=sale.pk, actor=actor)
            from stockkeeper.services import audit_movement
            audit_movement(movement)
        lines = []
        if total:
            lines.append(dr(contact.receivable_account, total, contact))
        lines.append(cr(category.ledger_account, total - delivery_fee))
        if delivery_fee:
            delivery_ledger, _ = LedgerAccount.objects.get_or_create(business=business, code='DELIVERY_INCOME',
                defaults={'name': 'Delivery Income', 'type': 'income', 'system_managed': True})
            lines.append(cr(delivery_ledger, delivery_fee))
        if cost:
            lines.extend([dr(ledger(business, 'COGS'), cost), cr(ledger(business, 'INVENTORY'), cost)])
        post(business, 'sale', sale.pk, f'Sale {sale.invoice_number}', lines, actor=actor)
        if paid:
            _collect_locked(sale, actor, command_id, paid, money, kind='receipt')
        record(business_id=business.pk, actor=actor, entity_type='sale', entity_id=sale.pk,
               action='completed', subject=sale.invoice_number, location_id=location.pk, reference_id=sale.pk,
               changes={'total': str(total), 'delivery_fee': str(delivery_fee), 'paid': str(paid), 'due': str(total-paid), 'line_count': len(prepared)})
        return sale


def sale_net_total(sale):
    returned = sum((item.amount for item in sale.returns.all()), Decimal('0'))
    return sale.total - returned


def _line_net_amount(sale, line, lines):
    """Allocate the invoice discount deterministically; the final line gets the rounding remainder."""
    product_total = sale.subtotal - sale.discount
    allocated = Decimal('0')
    for item in lines[:-1]:
        share = (product_total * item.line_total / sale.subtotal).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if item.pk == line.pk:
            return share
        allocated += share
    return product_total - allocated


def _returned_cost_portions(line, previous_base, requested_base):
    cursor = Decimal('0')
    result = []
    end = previous_base + requested_base
    for portion in line.cost_layers:
        size = Decimal(portion['quantity'])
        overlap = min(end, cursor + size) - max(previous_base, cursor)
        if overlap > 0:
            result.append((overlap, Decimal(portion['unit_cost'])))
        cursor += size
    if sum((qty for qty, _ in result), Decimal('0')) != requested_base:
        raise SaleError('The original stock cost cannot be reconciled for this return.')
    return result


@transaction.atomic
def return_sale(sale, actor, command_id, data):
    Business.objects.select_for_update().get(pk=sale.business_id)
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    prior = SaleReturn.objects.filter(sale=sale, command_id=command_id).first()
    if prior:
        return prior
    if sale.status != 'completed':
        raise SaleError('Only completed sales can be returned.')
    reason = str(data.get('reason') or '').strip()
    if not reason or len(reason) > 240:
        raise SaleError('Enter a return reason up to 240 characters.')
    raw_lines = data.get('lines')
    if not isinstance(raw_lines, list) or not raw_lines or len(raw_lines) > 100:
        raise SaleError('Choose at least one item to return.')
    sale_lines = list(sale.lines.order_by('pk'))
    indexed = {str(line.pk): line for line in sale_lines}
    prepared = []
    seen = set()
    return_amount = Decimal('0')
    sellable_cost = damaged_cost = Decimal('0')
    for item in raw_lines:
        if not isinstance(item, dict):
            raise SaleError('Choose valid sale items to return.')
        line_id = str(item.get('line_id') or '')
        if line_id in seen or line_id not in indexed:
            raise SaleError('Each returned item must belong to this sale and appear once.')
        seen.add(line_id)
        line = indexed[line_id]
        condition = item.get('condition')
        if condition not in ('sellable', 'damaged'):
            raise SaleError('Choose whether each returned item is sellable or damaged.')
        quantity = amount(item.get('quantity'), places=3)
        previous = list(line.return_lines.select_related('sale_return').all())
        previous_qty = sum((row.quantity for row in previous), Decimal('0'))
        if quantity > line.quantity - previous_qty:
            raise SaleError(f'Return quantity exceeds the remaining quantity for {line.product_name}.')
        base = (quantity * line.conversion_factor).quantize(Decimal('0.001'))
        previous_base = (previous_qty * line.conversion_factor).quantize(Decimal('0.001'))
        line_net = _line_net_amount(sale, line, sale_lines)
        already_credited = sum((row.amount for row in previous), Decimal('0'))
        if quantity == line.quantity - previous_qty:
            credited = line_net - already_credited
        else:
            cumulative = (line_net * (previous_qty + quantity) / line.quantity).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            credited = cumulative - already_credited
        if credited <= 0:
            raise SaleError('Return amount must be positive. Increase the returned quantity.')
        portions = _returned_cost_portions(line, previous_base, base)
        cost = sum((qty * unit_cost for qty, unit_cost in portions), Decimal('0')).quantize(Decimal('0.0000001'))
        prepared.append((line, quantity, base, condition, credited, cost, portions))
        return_amount += credited
        if condition == 'sellable':
            sellable_cost += cost
        else:
            damaged_cost += cost
    due = sale_net_total(sale) - sale.paid
    due_reduction = min(due, return_amount)
    refund_amount = return_amount - due_reduction
    account = None
    if refund_amount:
        account = MoneyAccount.objects.filter(business=sale.business, pk=data.get('refund_account_id'),
                                              is_active=True).select_related('ledger_account').first()
        if not account:
            raise SaleError('Choose an active money account for the refund.')
    journal_lines = [dr(sale.income_category.ledger_account, return_amount),
                     cr(ensure_party_accounts(sale.customer).receivable_account, return_amount, sale.customer)]
    if sellable_cost:
        journal_lines.extend([dr(ledger(sale.business, 'INVENTORY'), sellable_cost), cr(ledger(sale.business, 'COGS'), sellable_cost)])
    if damaged_cost:
        journal_lines.extend([dr(ledger(sale.business, 'INVENTORY_LOSS'), damaged_cost), cr(ledger(sale.business, 'COGS'), damaged_cost)])
    return_id = uuid4()
    journal = post(sale.business, 'sale_return', return_id, f'Return {sale.invoice_number}',
                   journal_lines, actor=actor, command_id=command_id)
    sale_return = SaleReturn.objects.create(id=return_id, sale=sale, command_id=command_id, actor=actor,
        reason=reason, amount=return_amount, due_reduction=due_reduction, refund_amount=refund_amount,
        refund_account=account, journal=journal)
    for line, quantity, base, condition, credited, cost, portions in prepared:
        SaleReturnLine.objects.create(sale_return=sale_return, sale_line=line, quantity=quantity,
            amount=credited, inventory_cost=cost, condition=condition)
        if condition == 'sellable':
            balance_row, _ = StockBalance.objects.select_for_update().get_or_create(
                business=sale.business, product=line.product, variant=line.variant, location=sale.location,
                batch=line.batch, defaults={'quantity': Decimal('0')})
            balance_row.quantity += base
            balance_row.save(update_fields=['quantity', 'updated_at'])
            for portion_qty, unit_cost in portions:
                CostLayer.objects.create(business=sale.business, product=line.product, variant=line.variant,
                    location=sale.location, batch=line.batch, received_quantity=portion_qty,
                    remaining_quantity=portion_qty, unit_cost=unit_cost)
            movement = StockMovement.objects.create(business=sale.business, product=line.product,
                variant=line.variant, location=sale.location, batch=line.batch, type='sale_return',
                quantity_change=base, inventory_cost=cost, unit_name=line.unit_name,
                conversion_factor=line.conversion_factor, reason=f'Return {sale.invoice_number}: {reason}',
                reference_id=sale_return.pk, actor=actor)
            from stockkeeper.services import audit_movement
            audit_movement(movement)
    if refund_amount:
        refund_journal = post(sale.business, 'sale_return_refund', sale_return.pk,
            f'Refund {sale.invoice_number}',
            [dr(ensure_party_accounts(sale.customer).receivable_account, refund_amount, sale.customer),
             cr(account.ledger_account, refund_amount)], actor=actor)
        MoneyTransaction.objects.create(business=sale.business, kind='sale_refund', amount=refund_amount,
            account=account, contact=sale.customer, note=f'Refund for {sale.invoice_number}',
            event_date=business_today(sale.business), journal=refund_journal)
        sale_return.refund_journal = refund_journal
        sale_return.save(update_fields=['refund_journal'])
        sale.paid -= refund_amount
    net_total = sale_net_total(sale)
    sale.payment_status = 'paid' if sale.paid == net_total else ('due' if sale.paid == 0 else 'partial')
    sale.save(update_fields=['paid', 'payment_status'])
    record(business_id=sale.business_id, actor=actor, entity_type='sale_return', entity_id=sale_return.pk,
        action='completed', subject=sale.invoice_number, location_id=sale.location_id,
        reference_id=sale.pk, changes={'reason': reason, 'amount': str(return_amount),
        'due_reduction': str(due_reduction), 'refund': str(refund_amount),
        'lines': [{'line_id': str(line.pk), 'quantity': str(quantity), 'condition': condition}
                  for line, quantity, _, condition, _, _, _ in prepared]})
    return sale_return


def _collect_locked(sale, actor, command_id, value, account, kind='receipt'):
    value = amount(value)
    if sale.status != 'completed' or value > sale_net_total(sale) - sale.paid:
        raise SaleError('Collection exceeds this sale’s remaining due.')
    if account.business_id != sale.business_id or not account.is_active:
        raise SaleError('Choose an active payment account.')
    journal = post(sale.business, 'sale_collection', uuid4(), f'Payment for {sale.invoice_number}',
        [dr(account.ledger_account, value), cr(ensure_party_accounts(sale.customer).receivable_account, value, sale.customer)],
        actor=actor, command_id=command_id)
    payment = SalePayment.objects.create(sale=sale, command_id=command_id, amount=value, account=account,
        journal=journal, actor=actor, kind=kind)
    MoneyTransaction.objects.create(business=sale.business, kind='sale_receipt', amount=value, account=account,
        contact=sale.customer, note=f'Payment for {sale.invoice_number}', event_date=business_today(sale.business), journal=journal)
    sale.paid += value
    sale.payment_status = 'paid' if sale.paid == sale_net_total(sale) else 'partial'
    sale.save(update_fields=['paid', 'payment_status'])
    return payment


@transaction.atomic
def collect_sale(sale, actor, command_id, value, account):
    Business.objects.select_for_update().get(pk=sale.business_id)
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    prior = SalePayment.objects.filter(sale=sale, command_id=command_id).first()
    if prior:
        return prior
    payment = _collect_locked(sale, actor, command_id, value, account)
    record(business_id=sale.business_id, actor=actor, entity_type='sale', entity_id=sale.pk,
           action='payment_collected', subject=sale.invoice_number, reference_id=sale.pk,
           changes={'amount': str(payment.amount), 'paid_total': str(sale.paid), 'due': str(sale_net_total(sale)-sale.paid)})
    return payment


@transaction.atomic
def cancel_sale(sale, actor, command_id, reason):
    Business.objects.select_for_update().get(pk=sale.business_id)
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    if sale.status == 'cancelled':
        if sale.cancellation_command_id == command_id:
            return sale
        raise SaleError('This sale was already cancelled.')
    if sale.returns.exists():
        raise SaleError('This sale has returns. Use the return history instead of cancelling it.')
    reason = str(reason or '').strip()
    if not reason or len(reason) > 240:
        raise SaleError('Enter a cancellation reason up to 240 characters.')
    from accounting.services import reverse
    journal = JournalEntry.objects.get(business=sale.business, source_type='sale', source_id=str(sale.pk))
    reverse(journal, actor, command_id, f'Cancel {sale.invoice_number}: {reason}')
    for line in sale.lines.select_related('product', 'variant', 'batch').all():
        balance, _ = StockBalance.objects.select_for_update().get_or_create(
            business=sale.business, product=line.product, variant=line.variant, location=sale.location, batch=line.batch,
            defaults={'quantity': Decimal('0')})
        balance.quantity += line.base_quantity
        balance.save(update_fields=['quantity', 'updated_at'])
        for portion in line.cost_layers:
            quantity = Decimal(portion['quantity'])
            CostLayer.objects.create(business=sale.business, product=line.product, variant=line.variant,
                location=sale.location, batch=line.batch, received_quantity=quantity,
                remaining_quantity=quantity, unit_cost=Decimal(portion['unit_cost']))
        movement = StockMovement.objects.create(business=sale.business, product=line.product, variant=line.variant,
            location=sale.location, batch=line.batch, type='sale_cancellation', quantity_change=line.base_quantity,
            inventory_cost=line.inventory_cost, unit_name=line.unit_name, conversion_factor=line.conversion_factor,
            reason=f'Cancel {sale.invoice_number}: {reason}', reference_id=sale.pk, actor=actor)
        record(business_id=sale.business_id, actor=actor, entity_type='stock', entity_id=movement.pk,
            subject=line.product_name, product_id=line.product_id, location_id=sale.location_id,
            action='sale_cancellation', reference_id=sale.pk,
            changes={'quantity_change': str(line.base_quantity), 'inventory_cost': str(line.inventory_cost), 'reason': reason})
    for payment in sale.payments.filter(kind='receipt').select_related('account__ledger_account'):
        refund_id = uuid4()
        refund_journal = post(sale.business, 'sale_refund', refund_id, f'Refund {sale.invoice_number}',
            [dr(ensure_party_accounts(sale.customer).receivable_account, payment.amount, sale.customer), cr(payment.account.ledger_account, payment.amount)], actor=actor)
        SalePayment.objects.create(sale=sale, command_id=refund_id, amount=payment.amount, account=payment.account,
            journal=refund_journal, actor=actor, kind='refund')
        MoneyTransaction.objects.create(business=sale.business, kind='sale_refund', amount=payment.amount,
            account=payment.account, contact=sale.customer, note=f'Refund for {sale.invoice_number}',
            event_date=business_today(sale.business), journal=refund_journal)
    sale.status = 'cancelled'
    sale.payment_status = 'cancelled'
    sale.cancellation_reason = reason
    sale.cancellation_command_id = command_id
    sale.save(update_fields=['status', 'payment_status', 'cancellation_reason', 'cancellation_command_id'])
    record(business_id=sale.business_id, actor=actor, entity_type='sale', entity_id=sale.pk,
        action='cancelled', subject=sale.invoice_number, location_id=sale.location_id,
        reference_id=sale.pk, changes={'reason': reason, 'refunded': str(sale.paid)})
    return sale


def serialize_sale(sale, include_lines=False):
    lines = list(sale.lines.all())
    purchase_cost = sum((line.inventory_cost for line in lines), Decimal('0'))
    returns = list(sale.returns.prefetch_related('lines').all())
    returned_amount = sum((row.amount for row in returns), Decimal('0'))
    returned_sellable_cost = sum((item.inventory_cost for row in returns for item in row.lines.all()
                                 if item.condition == 'sellable'), Decimal('0'))
    net_total = Decimal('0') if sale.status == 'cancelled' else sale.total - returned_amount
    result = {'id': str(sale.pk), 'invoice_number': sale.invoice_number,
        'quotation_id': str(sale.quotation_id) if sale.quotation_id else None,
        'customer_id': str(sale.customer_id) if sale.customer_id else None,
        'customer_name': sale.customer_name_snapshot or (sale.customer.name if sale.customer_id else 'Walk-in Customer'),
        'customer_phone': sale.customer_phone_snapshot, 'customer_address': sale.customer_address_snapshot,
        'location_id': sale.location_id,
        'mode': sale.mode, 'price_tier': sale.price_tier, 'status': sale.status, 'payment_status': sale.payment_status,
        'cancellation_reason': sale.cancellation_reason,
        'subtotal': str(sale.subtotal), 'discount': str(sale.discount), 'delivery_fee': str(sale.delivery_fee),
        'total': str(sale.total), 'net_total': str(net_total), 'returned_amount': str(returned_amount), 'paid': str(sale.paid),
        'purchase_cost': str(purchase_cost - returned_sellable_cost),
        'profit': str(net_total - (purchase_cost - returned_sellable_cost)),
        'item_count': len(lines), 'item_quantity': str(sum((line.quantity for line in lines), Decimal('0'))),
        'due': str(Decimal('0') if sale.status == 'cancelled' else net_total-sale.paid), 'created_at': sale.created_at.isoformat(),
        'invoice_date': sale.invoice_date.isoformat(), 'billing_address': sale.billing_address,
        'delivery_address': sale.delivery_address, 'source': sale.source, 'notes': sale.notes,
        'payment_account_names': [payment.account.name for payment in sale.payments.all() if payment.kind == 'receipt']}
    if include_lines:
        result['lines'] = [{'id': line.pk, 'product_id': str(line.product_id), 'variant_id': str(line.variant_id), 'name': line.product_name,
            'variant': line.variant_name, 'image_url': line.image_url_snapshot, 'sku': line.sku, 'unit': line.unit_name, 'quantity': str(line.quantity),
            'unit_price': str(line.unit_price), 'inventory_cost': str(line.inventory_cost), 'line_total': str(line.line_total),
            'returned_quantity': str(sum((item.quantity for row in returns for item in row.lines.all()
                                          if item.sale_line_id == line.pk), Decimal('0')))} for line in lines]
        result['payments'] = [{'id': str(payment.pk), 'amount': str(payment.amount), 'account_id': str(payment.account_id),
            'account_name': payment.account.name, 'kind': payment.kind, 'created_at': payment.created_at.isoformat()} for payment in sale.payments.all()]
        result['returns'] = [{'id': str(row.pk), 'reason': row.reason, 'amount': str(row.amount),
            'due_reduction': str(row.due_reduction), 'refund_amount': str(row.refund_amount),
            'refund_account_name': row.refund_account.name if row.refund_account_id else None,
            'created_at': row.created_at.isoformat(),
            'lines': [{'line_id': item.sale_line_id, 'quantity': str(item.quantity), 'condition': item.condition}
                      for item in row.lines.all()]} for row in returns]
    return result
