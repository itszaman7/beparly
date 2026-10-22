from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from django.db import transaction
from django.core.files.storage import default_storage
from django.utils.dateparse import parse_date

from accounting.models import Contact, IncomeCategory, JournalEntry, MoneyAccount, MoneyTransaction
from accounting.services import AccountingError, amount, cr, dr, ledger, post, create_financial_category
from accounts.models import Business
from audit.services import record
from products.models import Product, ProductUnit, StockBatch
from stockkeeper.models import CostLayer, StockBalance, StockMovement
from stockkeeper.services import (StockError, business_today, consume, normalize_quantity,
                                  resolve_variant, validate_batch, validate_location)

from .models import Sale, SaleLine, SalePayment, SaleSequence


class SaleError(ValueError):
    pass


def create_sale(business, actor, command_id, data):
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
        requested_category = data.get('income_category_id')
        category = IncomeCategory.objects.filter(
            business=business, pk=requested_category, ledger_account__is_active=True,
            ledger_account__type='income').select_related('ledger_account').first() if requested_category else None
        if not category:
            category = IncomeCategory.objects.filter(
                business=business, ledger_account__is_active=True,
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

        prepared, subtotal = [], Decimal('0')
        for item in raw_lines:
            product = Product.objects.filter(business=business, pk=item.get('product_id'), is_active=True).first()
            if not product:
                raise SaleError('A product is unavailable or belongs to another business.')
            variant = resolve_variant(product, item.get('variant_id'))
            unit = ProductUnit.objects.filter(product=product, variant=variant, pk=item.get('unit_id'), is_active=True).first() if item.get('unit_id') else None
            if item.get('unit_id') and not unit:
                raise SaleError('Choose an active unit for this product.')
            quantity = amount(item.get('quantity'), places=3)
            base, factor, unit_name = normalize_quantity(variant, quantity, unit.pk if unit else None)
            price = unit.selling_price if unit and unit.selling_price is not None else getattr(variant, f'{tier}_price')
            if price is None:
                raise SaleError(f'Add a {tier} price for {product.name}.')
            price = amount(price)
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
        total = subtotal - discount
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
        sale = Sale.objects.create(business=business, invoice_number=f'S-{sequence.value:06d}', customer=contact,
            customer_name_snapshot=contact.name or 'Walk-in Customer', customer_phone_snapshot=contact.phone,
            customer_address_snapshot={'address': contact.address, 'district': contact.district, 'area': contact.area},
            location=location, income_category=category, actor=actor, command_id=command_id, mode=mode,
            price_tier=tier, subtotal=subtotal, discount=discount, total=total, paid=Decimal('0'),
            payment_status='due', billing_address={'text': location.address.strip(), 'location_id': str(location.pk)},
            delivery_address={}, source=str(data.get('source') or '').strip()[:80],
            notes=str(data.get('notes') or '').strip()[:2000], invoice_date=invoice_date)
        from accounting.services import ensure_inventory_cutoff
        ensure_inventory_cutoff(business)
        cost = Decimal('0')
        for product, variant, batch, quantity, base, factor, unit_name, price, line_total in prepared:
            balance = StockBalance.objects.select_for_update().filter(business=business, variant=variant, location=location, batch=batch).first()
            if not balance or balance.quantity < base:
                raise StockError(f'Insufficient stock for {product.name} at {location.name}.')
            line_cost, portions = consume(product, variant, location, base, batch)
            cost += line_cost
            SaleLine.objects.create(sale=sale, product=product, variant=variant, batch=batch,
                product_name=product.name, variant_name=variant.label,
                image_url_snapshot=default_storage.url(product.image_key) if product.image_key else '',
                sku=variant.sku, unit_name=unit_name,
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
            lines.append(dr(ledger(business, 'AR'), total, contact))
        lines.append(cr(category.ledger_account, total))
        if cost:
            lines.extend([dr(ledger(business, 'COGS'), cost), cr(ledger(business, 'INVENTORY'), cost)])
        post(business, 'sale', sale.pk, f'Sale {sale.invoice_number}', lines, actor=actor)
        if paid:
            _collect_locked(sale, actor, command_id, paid, money, kind='receipt')
        record(business_id=business.pk, actor=actor, entity_type='sale', entity_id=sale.pk,
               action='completed', subject=sale.invoice_number, location_id=location.pk, reference_id=sale.pk,
               changes={'total': str(total), 'paid': str(paid), 'due': str(total-paid), 'line_count': len(prepared)})
        return sale


def _collect_locked(sale, actor, command_id, value, account, kind='receipt'):
    value = amount(value)
    if sale.status != 'completed' or value > sale.total - sale.paid:
        raise SaleError('Collection exceeds this sale’s remaining due.')
    if account.business_id != sale.business_id or not account.is_active:
        raise SaleError('Choose an active payment account.')
    journal = post(sale.business, 'sale_collection', uuid4(), f'Payment for {sale.invoice_number}',
        [dr(account.ledger_account, value), cr(ledger(sale.business, 'AR'), value, sale.customer)],
        actor=actor, command_id=command_id)
    payment = SalePayment.objects.create(sale=sale, command_id=command_id, amount=value, account=account,
        journal=journal, actor=actor, kind=kind)
    MoneyTransaction.objects.create(business=sale.business, kind='sale_receipt', amount=value, account=account,
        contact=sale.customer, note=f'Payment for {sale.invoice_number}', event_date=business_today(sale.business), journal=journal)
    sale.paid += value
    sale.payment_status = 'paid' if sale.paid == sale.total else 'partial'
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
           changes={'amount': str(payment.amount), 'paid_total': str(sale.paid), 'due': str(sale.total-sale.paid)})
    return payment


@transaction.atomic
def cancel_sale(sale, actor, command_id, reason):
    Business.objects.select_for_update().get(pk=sale.business_id)
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    if sale.status == 'cancelled':
        if sale.cancellation_command_id == command_id:
            return sale
        raise SaleError('This sale was already cancelled.')
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
            [dr(ledger(sale.business, 'AR'), payment.amount, sale.customer), cr(payment.account.ledger_account, payment.amount)], actor=actor)
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
    active_total = Decimal('0') if sale.status == 'cancelled' else sale.total
    result = {'id': str(sale.pk), 'invoice_number': sale.invoice_number, 'customer_id': str(sale.customer_id) if sale.customer_id else None,
        'customer_name': sale.customer_name_snapshot or (sale.customer.name if sale.customer_id else 'Walk-in Customer'),
        'customer_phone': sale.customer_phone_snapshot, 'customer_address': sale.customer_address_snapshot,
        'location_id': sale.location_id,
        'mode': sale.mode, 'price_tier': sale.price_tier, 'status': sale.status, 'payment_status': sale.payment_status,
        'cancellation_reason': sale.cancellation_reason,
        'subtotal': str(sale.subtotal), 'discount': str(sale.discount), 'total': str(sale.total), 'paid': str(sale.paid),
        'purchase_cost': str(purchase_cost), 'profit': str(active_total - purchase_cost),
        'item_count': len(lines), 'item_quantity': str(sum((line.quantity for line in lines), Decimal('0'))),
        'due': str(Decimal('0') if sale.status == 'cancelled' else sale.total-sale.paid), 'created_at': sale.created_at.isoformat(),
        'invoice_date': sale.invoice_date.isoformat(), 'billing_address': sale.billing_address,
        'delivery_address': sale.delivery_address, 'source': sale.source, 'notes': sale.notes,
        'payment_account_names': [payment.account.name for payment in sale.payments.all() if payment.kind == 'receipt']}
    if include_lines:
        result['lines'] = [{'product_id': str(line.product_id), 'variant_id': str(line.variant_id), 'name': line.product_name,
            'variant': line.variant_name, 'image_url': line.image_url_snapshot, 'sku': line.sku, 'unit': line.unit_name, 'quantity': str(line.quantity),
            'unit_price': str(line.unit_price), 'inventory_cost': str(line.inventory_cost), 'line_total': str(line.line_total)} for line in lines]
        result['payments'] = [{'id': str(payment.pk), 'amount': str(payment.amount), 'account_id': str(payment.account_id),
            'account_name': payment.account.name, 'kind': payment.kind, 'created_at': payment.created_at.isoformat()} for payment in sale.payments.all()]
    return result
