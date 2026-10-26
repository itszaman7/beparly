"""Separate financial credit, physical receipt, and executed refund events."""
import hashlib
import json
from decimal import Decimal
from uuid import uuid4

from django.db import transaction

from accounts.models import Business
from accounting.models import Contact, MoneyAccount, MoneyTransaction
from accounting.services import amount, cr, dr, ensure_party_accounts, ledger, post, setup_business
from audit.services import record
from stockkeeper.models import CostLayer, StockBalance, StockMovement
from stockkeeper.services import audit_movement, business_today, validate_location

from .models import Sale, SalePayment, SaleReturn, SaleReturnLine, SaleReturnReceipt, SaleReturnDisposition


def _digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'),
        default=str).encode('utf-8')).hexdigest()


def _cost_slice(portions, start, size):
    cursor, result = Decimal('0'), []
    end = start + size
    for portion in portions:
        quantity = Decimal(portion['quantity'])
        overlap = min(end, cursor + quantity) - max(start, cursor)
        if overlap > 0:
            result.append((overlap, Decimal(portion['unit_cost'])))
        cursor += quantity
    if sum((part for part, _ in result), Decimal('0')) != size:
        from .services import SaleError
        raise SaleError('Original FIFO cost portions do not cover this return.')
    return result


def _payment_status(sale):
    from .services import sale_net_total
    net = sale_net_total(sale)
    if sale.paid > net:
        return 'refund_due'
    if sale.paid == net:
        return 'paid'
    return 'due' if sale.paid == 0 else 'partial'


def _restore_sellable(business, sold, location, portions, cost, actor, reference_id, evidence):
    balance, _ = StockBalance.objects.select_for_update().get_or_create(
        business=business, product=sold.product, variant=sold.variant,
        location=location, batch=sold.batch, defaults={'quantity': Decimal('0')})
    base = sum((part for part, _ in portions), Decimal('0'))
    balance.quantity += base
    balance.save(update_fields=['quantity', 'updated_at'])
    for part, unit_cost in portions:
        CostLayer.objects.create(business=business, product=sold.product, variant=sold.variant,
            location=location, batch=sold.batch, received_quantity=part,
            remaining_quantity=part, unit_cost=unit_cost)
    movement = StockMovement.objects.create(business=business, product=sold.product,
        variant=sold.variant, location=location, batch=sold.batch, type='sale_return',
        quantity_change=base, inventory_cost=cost, unit_name=sold.unit_name,
        conversion_factor=sold.conversion_factor,
        reason=f'Returned goods restocked: {evidence}', reference_id=reference_id, actor=actor)
    audit_movement(movement)
    return movement


@transaction.atomic
def credit_sale(sale, actor, command_id, data):
    from .services import SaleError, _line_net_amount, _returned_cost_portions, sale_net_total
    Business.objects.select_for_update().get(pk=sale.business_id)
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    if not isinstance(data, dict) or set(data) - {'reason', 'lines', 'credit_delivery_fee'}:
        raise SaleError('Send a credit reason, sale items, and optional delivery credit.')
    fingerprint = _digest(data)
    prior = SaleReturn.objects.filter(sale=sale, command_id=command_id).first()
    if prior:
        if not prior.request_hash or prior.request_hash != fingerprint:
            raise SaleError('Retry the credit with its original details.')
        return prior
    if sale.status != 'completed':
        raise SaleError('Only completed sales can be credited.')
    reason = str(data.get('reason') or '').strip()
    if not reason or len(reason) > 240:
        raise SaleError('Enter a credit reason up to 240 characters.')
    raw_lines = data.get('lines')
    if not isinstance(raw_lines, list) or len(raw_lines) > 100:
        raise SaleError('Send the exact sale items to credit.')
    credit_delivery = data.get('credit_delivery_fee', False)
    if not isinstance(credit_delivery, bool):
        raise SaleError('Choose whether the delivery charge is credited.')
    prior_delivery = sum((row.delivery_credit for row in sale.returns.all()), Decimal('0'))
    delivery_credit = sale.delivery_fee - prior_delivery if credit_delivery else Decimal('0')
    if credit_delivery and delivery_credit <= 0:
        raise SaleError('The delivery charge was already credited or was not charged.')
    sale_lines = list(sale.lines.order_by('pk'))
    indexed = {str(line.pk): line for line in sale_lines}
    prepared, seen = [], set()
    product_credit = Decimal('0')
    for item in raw_lines:
        if not isinstance(item, dict) or set(item) != {'line_id', 'quantity'}:
            raise SaleError('Choose a sale line and credit quantity.')
        key = str(item['line_id'])
        if key in seen or key not in indexed:
            raise SaleError('Each credited item must belong to this sale and appear once.')
        seen.add(key)
        line = indexed[key]
        quantity = amount(item['quantity'], places=3)
        previous = list(line.return_lines.all())
        previous_qty = sum((row.quantity for row in previous), Decimal('0'))
        if quantity > line.quantity - previous_qty:
            raise SaleError('Credit quantity exceeds the uncredited sale quantity.')
        base = (quantity * line.conversion_factor).quantize(Decimal('0.001'))
        previous_base = (previous_qty * line.conversion_factor).quantize(Decimal('0.001'))
        line_net = _line_net_amount(sale, line, sale_lines)
        credited_before = sum((row.amount for row in previous), Decimal('0'))
        if quantity == line.quantity - previous_qty:
            credited = line_net - credited_before
        else:
            from decimal import ROUND_HALF_UP
            cumulative = (line_net * (previous_qty + quantity) / line.quantity).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP)
            credited = cumulative - credited_before
        if credited <= 0:
            raise SaleError('Credit amount must be positive. Increase the quantity.')
        portions = _returned_cost_portions(line, previous_base, base)
        cost = sum((part * unit_cost for part, unit_cost in portions), Decimal('0')).quantize(Decimal('0.0000001'))
        prepared.append((line, quantity, credited, cost, portions))
        product_credit += credited
    total_credit = product_credit + delivery_credit
    if total_credit <= 0:
        raise SaleError('Select goods or a delivery charge to credit.')
    due = max(Decimal('0'), sale_net_total(sale) - sale.paid)
    due_reduction = min(due, total_credit)
    refund_owed = total_credit - due_reduction
    setup_business(sale.business)
    party = ensure_party_accounts(sale.customer)
    lines = []
    if product_credit:
        lines.append(dr(sale.income_category.ledger_account, product_credit))
    if delivery_credit:
        lines.append(dr(ledger(sale.business, 'DELIVERY_INCOME'), delivery_credit))
    if due_reduction:
        lines.append(cr(party.receivable_account, due_reduction, party))
    if refund_owed:
        lines.append(cr(ledger(sale.business, 'CUSTOMER_REFUND'), refund_owed, party))
    return_id = uuid4()
    journal = post(sale.business, 'sale_return', return_id,
        f'Credit {sale.invoice_number}', lines, actor=actor, command_id=command_id)
    credit = SaleReturn.objects.create(id=return_id, sale=sale, command_id=command_id,
        actor=actor, reason=reason, amount=total_credit, due_reduction=due_reduction,
        refund_amount=Decimal('0'), delivery_credit=delivery_credit, request_hash=fingerprint,
        journal=journal)
    for line, quantity, credited, cost, portions in prepared:
        SaleReturnLine.objects.create(sale_return=credit, sale_line=line, quantity=quantity,
            amount=credited, inventory_cost=cost, condition='pending',
            cost_layers=[{'quantity': str(part), 'unit_cost': str(unit_cost)}
                         for part, unit_cost in portions])
    sale.payment_status = _payment_status(sale)
    sale.save(update_fields=['payment_status'])
    record(business_id=sale.business_id, actor=actor, entity_type='sale_return', entity_id=credit.pk,
        action='credit_posted', subject=sale.invoice_number, location_id=sale.location_id,
        reference_id=sale.pk, changes={'reason': reason, 'amount': str(total_credit),
        'due_reduction': str(due_reduction), 'refund_owed': str(refund_owed),
        'delivery_credit': str(delivery_credit),
        'lines': [{'sale_line_id': line.pk, 'variant_id': str(line.variant_id),
                   'batch_id': str(line.batch_id) if line.batch_id else None,
                   'quantity': str(quantity)} for line, quantity, _, _, _ in prepared]})
    return credit


@transaction.atomic
def receive_credited_goods(credit, actor, command_id, data):
    from .services import SaleError
    business = credit.sale.business
    Business.objects.select_for_update().get(pk=business.pk)
    fingerprint = _digest(data)
    prior = SaleReturnReceipt.objects.filter(business=business, command_id=command_id).first()
    if prior:
        if prior.return_line.sale_return_id != credit.pk or prior.request_hash != fingerprint:
            raise SaleError('Retry the goods receipt with its original details.')
        return prior
    required = {'return_line_id', 'product_id', 'variant_id', 'batch_id', 'quantity',
                'location_id', 'condition', 'received_confirmed', 'evidence_reference'}
    if not isinstance(data, dict) or set(data) != required or data['received_confirmed'] is not True:
        raise SaleError('Confirm the exact goods, location, condition and physical receipt.')
    line = SaleReturnLine.objects.select_related('sale_line__sale', 'sale_return').filter(
        sale_return=credit, pk=data['return_line_id']).first()
    if not line or not line.sale_return.request_hash:
        raise SaleError('Choose a credited item from this sale.')
    sold = line.sale_line
    if (str(sold.product_id) != str(data['product_id']) or
            str(sold.variant_id) != str(data['variant_id']) or
            (str(sold.batch_id) if sold.batch_id else None) != data['batch_id']):
        raise SaleError('Returned product, variant and batch must match the original sale item.')
    location = validate_location(business.pk, data['location_id'])
    condition = data['condition']
    if condition not in ('sellable', 'damaged', 'inspection'):
        raise SaleError('Choose sellable, damaged or awaiting inspection condition.')
    evidence = str(data['evidence_reference'] or '').strip()
    if not evidence or len(evidence) > 120:
        raise SaleError('Enter physical receipt evidence up to 120 characters.')
    quantity = amount(data['quantity'], places=3)
    received_before = sum((row.quantity for row in line.receipts.all()), Decimal('0'))
    if quantity > line.quantity - received_before:
        raise SaleError('Physical receipt exceeds credited, unreceived quantity.')
    base = (quantity * sold.conversion_factor).quantize(Decimal('0.001'))
    offset = (received_before * sold.conversion_factor).quantize(Decimal('0.001'))
    portions = _cost_slice(line.cost_layers, offset, base)
    cost = sum((part * unit_cost for part, unit_cost in portions), Decimal('0')).quantize(Decimal('0.0000001'))
    if condition == 'sellable' and sold.batch_id and sold.batch.expires_on and sold.batch.expires_on < business_today(business):
        raise SaleError('Expired goods cannot re-enter sellable stock.')
    receipt_id = uuid4()
    movement = None
    if condition == 'sellable':
        movement = _restore_sellable(business, sold, location, portions, cost,
            actor, receipt_id, evidence)
    journal = None
    if cost and condition != 'inspection':
        debit = 'INVENTORY' if condition == 'sellable' else 'INVENTORY_LOSS'
        journal = post(business, 'sale_return_receipt', receipt_id,
            f'Goods received for {credit.sale.invoice_number}',
            [dr(ledger(business, debit), cost), cr(ledger(business, 'COGS'), cost)],
            actor=actor, command_id=command_id)
    receipt = SaleReturnReceipt.objects.create(id=receipt_id, business=business,
        return_line=line, location=location, quantity=quantity, inventory_cost=cost,
        condition=condition, evidence_reference=evidence, actor=actor, command_id=command_id,
        request_hash=fingerprint, journal=journal, movement=movement,
        cost_layers=[{'quantity': str(part), 'unit_cost': str(unit_cost)}
                     for part, unit_cost in portions])
    record(business_id=business.pk, actor=actor, entity_type='sale_return_receipt',
        entity_id=receipt.pk, action='received', subject=credit.sale.invoice_number,
        product_id=sold.product_id, location_id=location.pk, reference_id=credit.pk,
        changes={'sale_line_id': sold.pk, 'variant_id': str(sold.variant_id),
                 'batch_id': str(sold.batch_id) if sold.batch_id else None,
                 'quantity': str(quantity), 'condition': condition,
                 'inventory_cost': str(cost), 'evidence_reference': evidence})
    return receipt


@transaction.atomic
def decide_inspected_goods(receipt, actor, command_id, data):
    """Finalize custody; supplier dispatch does not invent a supplier credit."""
    from .services import SaleError
    business = receipt.business
    Business.objects.select_for_update().get(pk=business.pk)
    fingerprint = _digest(data)
    prior = SaleReturnDisposition.objects.filter(business=business, command_id=command_id).first()
    if prior:
        if prior.receipt_id != receipt.pk or prior.request_hash != fingerprint:
            raise SaleError('Retry the inspection decision with its original details.')
        return prior
    required = {'action', 'decision_confirmed', 'evidence_reference', 'supplier_id'}
    if not isinstance(data, dict) or set(data) != required or data['decision_confirmed'] is not True:
        raise SaleError('Confirm the final inspection decision and evidence.')
    receipt = SaleReturnReceipt.objects.select_related(
        'return_line__sale_line__batch', 'return_line__sale_return__sale', 'location'
    ).get(pk=receipt.pk, business=business)
    if receipt.condition != 'inspection' or hasattr(receipt, 'disposition'):
        raise SaleError('This receipt is not awaiting an inspection decision.')
    action = data['action']
    if action not in ('restocked', 'written_off', 'returned_to_supplier'):
        raise SaleError('Choose restocked, written off or returned to supplier.')
    evidence = str(data['evidence_reference'] or '').strip()
    if not evidence or len(evidence) > 120:
        raise SaleError('Enter inspection evidence up to 120 characters.')
    supplier_id = data['supplier_id']
    supplier = None
    if action == 'returned_to_supplier':
        supplier = Contact.objects.filter(business=business, pk=supplier_id,
            is_supplier=True).first()
        if not supplier:
            raise SaleError('Choose a supplier in this business for the physical dispatch.')
    elif supplier_id is not None:
        raise SaleError('A supplier is only used for a physical supplier return.')
    sold = receipt.return_line.sale_line
    if (action == 'restocked' and sold.batch_id and sold.batch.expires_on and
            sold.batch.expires_on < business_today(business)):
        raise SaleError('Expired goods cannot re-enter sellable stock.')
    portions = [(Decimal(row['quantity']), Decimal(row['unit_cost']))
                for row in receipt.cost_layers]
    base = (receipt.quantity * sold.conversion_factor).quantize(Decimal('0.001'))
    if sum((part for part, _ in portions), Decimal('0')) != base:
        raise SaleError('Original FIFO portions do not cover the inspected goods.')
    decision_id = uuid4()
    movement = None
    if action == 'restocked':
        movement = _restore_sellable(business, sold, receipt.location, portions,
            receipt.inventory_cost, actor, decision_id, evidence)
    journal = None
    if receipt.inventory_cost and action != 'returned_to_supplier':
        debit = 'INVENTORY' if action == 'restocked' else 'INVENTORY_LOSS'
        journal = post(business, 'sale_return_disposition', decision_id,
            f'Inspection decision for {receipt.return_line.sale_return.sale.invoice_number}',
            [dr(ledger(business, debit), receipt.inventory_cost),
             cr(ledger(business, 'COGS'), receipt.inventory_cost)],
            actor=actor, command_id=command_id)
    decision = SaleReturnDisposition.objects.create(id=decision_id, business=business,
        receipt=receipt, action=action, supplier=supplier, evidence_reference=evidence,
        actor=actor, command_id=command_id, request_hash=fingerprint,
        journal=journal, movement=movement)
    record(business_id=business.pk, actor=actor, entity_type='sale_return_disposition',
        entity_id=decision.pk, action=action, subject=receipt.return_line.sale_return.sale.invoice_number,
        product_id=sold.product_id, location_id=receipt.location_id, reference_id=receipt.pk,
        changes={'variant_id': str(sold.variant_id),
                 'batch_id': str(sold.batch_id) if sold.batch_id else None,
                 'quantity': str(receipt.quantity), 'original_fifo_cost': str(receipt.inventory_cost),
                 'supplier_id': str(supplier.pk) if supplier else None,
                 'evidence_reference': evidence,
                 'supplier_credit_recorded': False if supplier else None})
    return decision


@transaction.atomic
def refund_credited_sale(credit, actor, command_id, data):
    from .services import SaleError
    business = credit.sale.business
    Business.objects.select_for_update().get(pk=business.pk)
    sale = Sale.objects.select_for_update().get(pk=credit.sale_id)
    if not credit.request_hash:
        raise SaleError('Historical bundled returns require evidence review before another refund.')
    fingerprint = _digest(data)
    prior = SalePayment.objects.filter(sale=sale, command_id=command_id).first()
    if prior:
        if prior.kind != 'refund' or prior.sale_return_id != credit.pk or prior.request_hash != fingerprint:
            raise SaleError('Retry the refund with its original details.')
        return prior
    required = {'amount', 'account_id', 'refund_confirmed', 'confirmation_reference'}
    if not isinstance(data, dict) or set(data) != required or data['refund_confirmed'] is not True:
        raise SaleError('Confirm the executed refund, amount, account and reference.')
    value = amount(data['amount'])
    evidence = str(data['confirmation_reference'] or '').strip()
    if not evidence or len(evidence) > 120:
        raise SaleError('Enter a refund confirmation reference up to 120 characters.')
    account = MoneyAccount.objects.filter(business=business, pk=data['account_id'],
        is_active=True).select_related('ledger_account').first()
    if not account:
        raise SaleError('Choose an active refund money account in this business.')
    refunded = credit.refund_amount + sum((row.amount for row in credit.refund_payments.all()), Decimal('0'))
    outstanding = credit.amount - credit.due_reduction - refunded
    if value > outstanding:
        raise SaleError('Refund exceeds the outstanding amount for this credit.')
    party = ensure_party_accounts(sale.customer)
    payment_id = uuid4()
    journal = post(business, 'sale_return_refund', payment_id,
        f'Executed refund for {sale.invoice_number}',
        [dr(ledger(business, 'CUSTOMER_REFUND'), value, party),
         cr(account.ledger_account, value)], actor=actor, command_id=command_id)
    payment = SalePayment.objects.create(id=payment_id, sale=sale, sale_return=credit,
        command_id=command_id, amount=value, account=account, journal=journal,
        actor=actor, kind='refund', confirmation_reference=evidence, request_hash=fingerprint)
    MoneyTransaction.objects.create(business=business, kind='sale_refund', amount=value,
        account=account, contact=party, note=f'Refund {sale.invoice_number}: {evidence}',
        event_date=business_today(business), journal=journal)
    sale.paid -= value
    sale.payment_status = _payment_status(sale)
    sale.save(update_fields=['paid', 'payment_status'])
    record(business_id=business.pk, actor=actor, entity_type='sale_refund', entity_id=payment.pk,
        action='executed', subject=sale.invoice_number, reference_id=credit.pk,
        changes={'amount': str(value), 'account_id': str(account.pk),
                 'confirmation_reference': evidence, 'remaining': str(outstanding-value)})
    return payment
