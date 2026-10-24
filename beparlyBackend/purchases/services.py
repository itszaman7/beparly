from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from django.db import transaction
from django.db.models import Sum
from django.core.files.storage import default_storage
from django.utils import timezone

from accounting.models import Contact, JournalEntry, JournalLine, MoneyAccount, MoneyTransaction
from accounting.services import AccountingError, amount, contact_position, cr, dr, ledger, post, reverse, setup_business, ensure_party_accounts
from accounts.models import Business
from audit.services import record
from products.models import Product, ProductUnit, StockBatch
from stockkeeper.models import CostLayer, StockBalance, StockMovement
from stockkeeper.services import (StockError, audit_movement, business_today, normalize_quantity,
                                  receive, resolve_variant, validate_batch, validate_location)

from .models import OpeningPayable, Purchase, PurchaseLine, PurchaseSequence, SupplierOperation


class PurchaseError(ValueError):
    pass


def supplier_data(supplier):
    return {'id': str(supplier.pk), 'name': supplier.name, 'phone': supplier.phone,
            'address': supplier.address, 'area': supplier.area, 'district': supplier.district,
            'notes': supplier.notes, 'payment_terms': supplier.payment_terms,
            'image_url': default_storage.url(supplier.image_key) if supplier.image_key else None,
            'is_customer': supplier.is_customer, 'is_supplier': supplier.is_supplier,
            **contact_position(supplier)}


def purchase_data(purchase, details=False):
    result = {'id': str(purchase.pk), 'number': purchase.number, 'status': purchase.status,
              'supplier_id': str(purchase.supplier_id), 'supplier_name': purchase.supplier_name or purchase.supplier.name,
              'location_id': purchase.location_id, 'location_name': purchase.location_name or purchase.location.name,
              'total': str(purchase.total), 'paid': str(purchase.paid),
              'due': str(purchase.total - purchase.paid if purchase.status == 'completed' else 0),
              'notes': purchase.notes, 'created_at': purchase.created_at.isoformat(),
              'completed_at': purchase.completed_at.isoformat() if purchase.completed_at else None,
              'cancellation_reason': purchase.cancellation_reason}
    if details:
        result['lines'] = [{'id': line.pk, 'product_id': str(line.product_id), 'variant_id': str(line.variant_id),
            'batch_id': str(line.batch_id) if line.batch_id else None, 'unit_id': str(line.unit_id) if line.unit_id else None,
            'product_name': line.product_name or line.product.name, 'variant_name': line.variant_name or line.variant.label,
            'sku': line.sku or line.variant.sku, 'base_unit': line.variant.base_unit,
            'image_url': default_storage.url(line.product.image_key) if line.product.image_key else None,
            'tracking_mode': line.variant.tracking_mode, 'unit_name': line.unit_name or (line.unit.name if line.unit else line.variant.base_unit),
            'lot_code': line.lot_code or (line.batch.lot_code if line.batch else ''),
            'quantity': str(line.quantity), 'base_quantity': str(line.base_quantity),
            'unit_cost': str(line.unit_cost), 'line_total': str(line.line_total)} for line in purchase.lines.select_related('product', 'variant', 'unit', 'batch')]
        result['operations'] = [{'id': str(op.pk), 'kind': op.kind, 'amount': str(op.amount),
            'created_at': op.created_at.isoformat()} for op in purchase.operations.order_by('created_at')]
    return result


@transaction.atomic
def create_supplier(business, actor, data, command_id):
    Business.objects.select_for_update().get(pk=business.pk)
    prior = OpeningPayable.objects.filter(business=business, command_id=command_id).first()
    if prior:
        if prior.supplier.name != str(data.get('name', '')).strip() or prior.amount != amount(data.get('opening_payable', '0'), positive=False):
            raise PurchaseError('Retry supplier creation with its original details.')
        return prior.supplier
    # Creation without opening payable is also retry safe via an audit command reference.
    from audit.models import AuditEvent
    prior_event = AuditEvent.objects.filter(business=business, entity_type='supplier', action='created', reference_id=command_id).first()
    if prior_event:
        existing = Contact.objects.get(business=business, pk=prior_event.entity_id)
        if existing.name != str(data.get('name', '')).strip() or amount(data.get('opening_payable', '0'), positive=False):
            raise PurchaseError('Retry supplier creation with its original details.')
        return existing
    name = data.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 160:
        raise PurchaseError('Enter a supplier name up to 160 characters.')
    fields = {}
    for key, limit in [('phone', 20), ('address', 255), ('area', 100), ('district', 80), ('notes', 2000), ('payment_terms', 240)]:
        value = data.get(key, '')
        if not isinstance(value, str) or len(value.strip()) > limit:
            raise PurchaseError(f'{key.replace("_", " ").title()} is too long.')
        fields[key] = value.strip()
    opening = amount(data.get('opening_payable', '0'), positive=False)
    setup_business(business)
    supplier = Contact.objects.create(business=business, name=name.strip(), is_supplier=True, created_by=actor, **fields)
    if opening:
        entry = post(business, 'supplier_opening', supplier.pk, f'Opening payable: {supplier.name}',
            [dr(ledger(business, 'OPENING'), opening), cr(ensure_party_accounts(supplier).payable_account, opening, supplier)], actor=actor)
        OpeningPayable.objects.create(business=business, supplier=supplier, amount=opening,
            command_id=command_id, journal=entry)
    record(business_id=business.pk, actor=actor, entity_type='supplier', entity_id=supplier.pk,
           action='created', subject=supplier.name, reference_id=command_id,
           changes={'name': supplier.name, 'opening_payable': str(opening)})
    return supplier


@transaction.atomic
def update_supplier(supplier, actor, data):
    Business.objects.select_for_update().get(pk=supplier.business_id)
    changes = {}
    for key, limit in [('name', 160), ('phone', 20), ('address', 255), ('area', 100), ('district', 80), ('notes', 2000), ('payment_terms', 240)]:
        if key not in data:
            continue
        value = data[key]
        if not isinstance(value, str) or len(value.strip()) > limit or (key == 'name' and not value.strip()):
            raise PurchaseError(f'Enter a valid {key.replace("_", " ")}.')
        if getattr(supplier, key) != value.strip():
            changes[key] = {'before': getattr(supplier, key), 'after': value.strip()}
            setattr(supplier, key, value.strip())
    if set(data) - {'name', 'phone', 'address', 'area', 'district', 'notes', 'payment_terms'}:
        raise PurchaseError('Only supplier profile fields can be edited here.')
    if changes:
        supplier.save(update_fields=[*changes, 'updated_at'])
        record(business_id=supplier.business_id, actor=actor, entity_type='supplier', entity_id=supplier.pk,
               action='updated', subject=supplier.name, changes=changes)
    return supplier


def prepare_lines(business, raw_lines):
    if not isinstance(raw_lines, list) or not 1 <= len(raw_lines) <= 1000:
        raise PurchaseError('Add one to 1,000 product lines.')
    prepared = []
    total = Decimal('0')
    for item in raw_lines:
        if not isinstance(item, dict):
            raise PurchaseError('Each purchase line must be an object.')
        product = Product.objects.filter(business=business, pk=item.get('product_id'), is_active=True).first()
        if not product:
            raise PurchaseError('Choose an active product in this business.')
        variant = resolve_variant(product, item.get('variant_id'))
        unit = ProductUnit.objects.filter(product=product, variant=variant, pk=item.get('unit_id'), is_active=True).first() if item.get('unit_id') else None
        if item.get('unit_id') and not unit:
            raise PurchaseError('Choose an active packaging unit for this variant.')
        quantity = amount(item.get('quantity'), places=3)
        base, factor, unit_name = normalize_quantity(variant, quantity, unit.pk if unit else None)
        unit_cost = amount(item.get('unit_cost'), places=4)
        base_cost = unit_cost / factor
        if base_cost != base_cost.quantize(Decimal('0.0001')):
            raise PurchaseError('Packaging cost must convert exactly to four decimal places per base unit.')
        exact_total = base * base_cost
        if exact_total != exact_total.quantize(Decimal('0.01')):
            raise PurchaseError('Line value must be an exact amount in taka and poisha.')
        batch = StockBatch.objects.filter(product=product, variant=variant, pk=item.get('batch_id')).first() if item.get('batch_id') else None
        validate_batch(variant, batch)
        total += exact_total
        prepared.append((product, variant, unit, batch, quantity, base, factor, unit_name, unit_cost, base_cost, exact_total))
    return prepared, total


@transaction.atomic
def save_draft(business, actor, command_id, data, purchase=None):
    Business.objects.select_for_update().get(pk=business.pk)
    if purchase is None:
        prior = Purchase.objects.filter(business=business, create_command_id=command_id).first()
        if prior:
            if prior.status != 'draft' or str(prior.supplier_id) != str(data.get('supplier_id')) or prior.location_id != data.get('location_id'):
                raise PurchaseError('Retry this draft command with its original details.')
            raw_lines = data.get('lines')
            saved = list(prior.lines.order_by('pk').values('product_id', 'variant_id', 'unit_id', 'batch_id', 'quantity', 'unit_cost'))
            if not isinstance(raw_lines, list) or len(saved) != len(raw_lines) or prior.notes != data.get('notes', ''):
                raise PurchaseError('Retry this draft command with its original details.')
            for old, new in zip(saved, raw_lines):
                if (not isinstance(new, dict) or str(old['product_id']) != str(new.get('product_id')) or
                        (new.get('variant_id') and str(old['variant_id']) != str(new['variant_id'])) or
                        str(old['unit_id'] or '') != str(new.get('unit_id') or '') or
                        str(old['batch_id'] or '') != str(new.get('batch_id') or '') or
                        old['quantity'] != amount(new.get('quantity'), places=3) or
                        old['unit_cost'] != amount(new.get('unit_cost'), places=4)):
                    raise PurchaseError('Retry this draft command with its original details.')
            return prior
    else:
        purchase = Purchase.objects.select_for_update().get(pk=purchase.pk)
        if purchase.status != 'draft':
            raise PurchaseError('Only draft purchases can be edited.')
    supplier = Contact.objects.filter(business=business, pk=data.get('supplier_id'), is_supplier=True, is_active=True).first()
    if not supplier:
        raise PurchaseError('Choose an active supplier in this business.')
    location = validate_location(business.pk, data.get('location_id'))
    prepared, total = prepare_lines(business, data.get('lines'))
    notes = data.get('notes', '')
    if not isinstance(notes, str) or len(notes) > 2000:
        raise PurchaseError('Notes must be up to 2000 characters.')
    if purchase is None:
        purchase = Purchase.objects.create(business=business, supplier=supplier, location=location,
            notes=notes, total=total, actor=actor, create_command_id=command_id)
    else:
        purchase.lines.all().delete()
        purchase.supplier, purchase.location, purchase.notes, purchase.total = supplier, location, notes, total
        purchase.save(update_fields=['supplier', 'location', 'notes', 'total'])
    for product, variant, unit, batch, qty, base, factor, unit_name, unit_cost, base_cost, value in prepared:
        PurchaseLine.objects.create(purchase=purchase, product=product, variant=variant, unit=unit,
            batch=batch, quantity=qty, base_quantity=base, conversion_factor=factor,
            unit_cost=unit_cost, line_total=value)
    record(business_id=business.pk, actor=actor, entity_type='purchase', entity_id=purchase.pk,
           action='draft_saved', subject=supplier.name, changes={'total': str(total), 'lines': len(prepared)})
    return purchase


@transaction.atomic
def complete_purchase(purchase, actor, command_id, paid=0, account=None):
    business = purchase.business
    Business.objects.select_for_update().get(pk=business.pk)
    purchase = Purchase.objects.select_for_update().get(pk=purchase.pk)
    if purchase.status == 'completed' and purchase.completion_command_id == command_id:
        return purchase
    if purchase.status != 'draft':
        raise PurchaseError('Only an editable draft can be completed.')
    if Purchase.objects.filter(business=business, completion_command_id=command_id).exists():
        raise PurchaseError('This command ID belongs to another purchase.')
    supplier = Contact.objects.filter(pk=purchase.supplier_id, business=business, is_supplier=True, is_active=True).first()
    if not supplier:
        raise PurchaseError('Supplier is unavailable.')
    location = validate_location(business.pk, purchase.location_id)
    lines = list(purchase.lines.select_related('product', 'variant', 'unit', 'batch'))
    if not lines:
        raise PurchaseError('Add products before completing the purchase.')
    paid = amount(paid, positive=False)
    if paid > purchase.total:
        raise PurchaseError('Payment exceeds purchase total.')
    if paid and (not account or account.business_id != business.pk or not account.is_active):
        raise PurchaseError('Choose an active money account.')
    setup_business(business)
    sequence, _ = PurchaseSequence.objects.select_for_update().get_or_create(business=business)
    sequence.value += 1
    sequence.save(update_fields=['value'])
    purchase.number = f'P-{sequence.value:03d}'
    purchase.supplier_name = supplier.name
    purchase.supplier_phone = supplier.phone
    purchase.supplier_address = supplier.address
    purchase.location_name = location.name
    total = Decimal('0')
    for line in lines:
        product = Product.objects.filter(pk=line.product_id, business=business, is_active=True).first()
        if not product or not line.variant.is_active:
            raise PurchaseError('A product or variant is no longer active.')
        variant = resolve_variant(product, str(line.variant_id))
        validate_batch(variant, line.batch)
        base, factor, unit_name = normalize_quantity(variant, line.quantity, str(line.unit_id) if line.unit_id else None)
        base_cost = line.unit_cost / factor
        if base_cost != base_cost.quantize(Decimal('0.0001')) or base * base_cost != line.line_total:
            raise PurchaseError('Purchase line costs have changed. Edit the draft before completing.')
        movement = receive(product, location, line.quantity, base_cost, actor, purchase.pk,
            movement_type='purchase', reason=f'Purchase {purchase.number}', batch=line.batch,
            unit_id=str(line.unit_id) if line.unit_id else None, variant=variant, post_inventory_journal=False)
        layer = CostLayer.objects.filter(business=business, product=product, variant=variant,
            location=location, batch=line.batch).order_by('-pk').first()
        line.product_name, line.variant_name, line.sku = product.name, variant.label, variant.sku
        line.unit_name, line.lot_code = unit_name, line.batch.lot_code if line.batch else ''
        line.movement, line.cost_layer = movement, layer
        line.save(update_fields=['product_name', 'variant_name', 'sku', 'unit_name', 'lot_code', 'movement', 'cost_layer'])
        total += movement.inventory_cost
    if total != purchase.total:
        raise PurchaseError('Inventory value and supplier payable do not reconcile.')
    post(business, 'purchase', purchase.pk, f'Purchase {purchase.number}',
        [dr(ledger(business, 'INVENTORY'), total), cr(ensure_party_accounts(supplier).payable_account, total, supplier)], actor=actor)
    purchase.status, purchase.completed_at, purchase.completion_command_id = 'completed', timezone.now(), command_id
    purchase.save(update_fields=['status', 'completed_at', 'completion_command_id', 'number',
        'supplier_name', 'supplier_phone', 'supplier_address', 'location_name'])
    if paid:
        supplier_operation(business, supplier, actor, uuid4(), 'payment', paid,
            purchase=purchase, account=account)
    record(business_id=business.pk, actor=actor, entity_type='purchase', entity_id=purchase.pk,
        action='completed', subject=purchase.number, location_id=location.pk, reference_id=purchase.pk,
        changes={'total': str(total), 'paid': str(paid), 'line_count': len(lines)})
    return purchase


@transaction.atomic
def supplier_operation(business, supplier, actor, command_id, kind, value, *, purchase=None, opening=None, account=None):
    Business.objects.select_for_update().get(pk=business.pk)
    if purchase:
        purchase = Purchase.objects.select_for_update().get(pk=purchase.pk)
    if opening:
        opening = OpeningPayable.objects.select_for_update().get(pk=opening.pk)
    prior = SupplierOperation.objects.filter(business=business, command_id=command_id).first()
    if prior:
        if (prior.kind != kind or prior.supplier_id != supplier.pk or prior.purchase_id != (purchase.pk if purchase else None)
                or prior.opening_id != (opening.pk if opening else None) or prior.amount != amount(value)
                or prior.account_id != (account.pk if account else None)):
            raise PurchaseError('Retry this command with its original details.')
        return prior
    if supplier.business_id != business.pk or not supplier.is_supplier:
        raise PurchaseError('Choose a supplier in this business.')
    supplier = ensure_party_accounts(supplier)
    value = amount(value)
    if kind not in ('payment', 'advance', 'advance_refund', 'apply_advance', 'allocation_reversal', 'payment_refund'):
        raise PurchaseError('Choose a valid supplier action.')
    if kind in ('payment', 'apply_advance', 'allocation_reversal', 'payment_refund'):
        if bool(purchase) == bool(opening):
            raise PurchaseError('Choose exactly one payable.')
        target = purchase or opening
        if target.business_id != business.pk or target.supplier_id != supplier.pk or (purchase and purchase.status != 'completed'):
            raise PurchaseError('Payable is unavailable for this supplier.')
        if kind in ('payment_refund', 'allocation_reversal'):
            prior_kind = 'payment' if kind == 'payment_refund' else 'apply_advance'
            net = sum((op.amount for op in SupplierOperation.objects.filter(
                business=business, purchase=purchase, opening=opening, kind=prior_kind)), Decimal('0'))
            reversed_kind = kind
            net -= sum((op.amount for op in SupplierOperation.objects.filter(
                business=business, purchase=purchase, opening=opening, kind=reversed_kind)), Decimal('0'))
            if value > net:
                raise PurchaseError('Amount exceeds the unsettled payment or allocation.')
        elif value > (target.total if purchase else target.amount) - target.paid:
            raise PurchaseError('Amount exceeds remaining payable.')
    elif purchase or opening:
        raise PurchaseError('Advance actions do not select a payable.')
    if kind in ('advance', 'advance_refund', 'apply_advance'):
        advance = Decimal(contact_position(supplier)['supplier_advance'])
        if kind != 'advance' and value > advance:
            raise PurchaseError('Amount exceeds available supplier advance.')
    if kind not in ('apply_advance', 'allocation_reversal') and (not account or account.business_id != business.pk or not account.is_active):
        raise PurchaseError('Choose an active money account.')
    setup_business(business)
    if kind == 'payment':
        lines = [dr(supplier.payable_account, value, supplier), cr(account.ledger_account, value)]
    elif kind == 'payment_refund':
        lines = [dr(account.ledger_account, value), cr(supplier.payable_account, value, supplier)]
    elif kind == 'advance':
        lines = [dr(ledger(business, 'SUPPLIER_ADVANCE'), value, supplier), cr(account.ledger_account, value)]
    elif kind == 'advance_refund':
        lines = [dr(account.ledger_account, value), cr(ledger(business, 'SUPPLIER_ADVANCE'), value, supplier)]
    elif kind == 'allocation_reversal':
        lines = [dr(ledger(business, 'SUPPLIER_ADVANCE'), value, supplier), cr(supplier.payable_account, value, supplier)]
    else:
        lines = [dr(supplier.payable_account, value, supplier), cr(ledger(business, 'SUPPLIER_ADVANCE'), value, supplier)]
    op_id = uuid4()
    journal = post(business, 'supplier_operation', op_id, f'{kind}: {supplier.name}', lines,
        actor=actor, command_id=command_id)
    operation = SupplierOperation.objects.create(id=op_id, business=business, supplier=supplier,
        purchase=purchase, opening=opening, kind=kind, amount=value, account=account,
        command_id=command_id, journal=journal)
    if kind in ('payment', 'apply_advance', 'payment_refund', 'allocation_reversal'):
        target.paid += -value if kind in ('payment_refund', 'allocation_reversal') else value
        target.save(update_fields=['paid'])
    if account:
        MoneyTransaction.objects.create(business=business, kind=f'supplier_{kind}', amount=value,
            account=account, contact=supplier, note=f'{kind}: {supplier.name}',
            event_date=business_today(business), journal=journal)
    record(business_id=business.pk, actor=actor, entity_type='supplier', entity_id=supplier.pk,
        action=kind, subject=supplier.name, changes={'amount': str(value),
        'payable': str(target.pk) if kind in ('payment', 'apply_advance', 'payment_refund', 'allocation_reversal') else None})
    return operation


@transaction.atomic
def cancel_purchase(purchase, actor, command_id, reason):
    business = purchase.business
    Business.objects.select_for_update().get(pk=business.pk)
    purchase = Purchase.objects.select_for_update().get(pk=purchase.pk)
    if purchase.status == 'cancelled':
        if purchase.cancellation_command_id == command_id:
            return purchase
        raise PurchaseError('This purchase was already cancelled.')
    reason = str(reason or '').strip()
    if purchase.status == 'completed' and (not reason or len(reason) > 240):
        raise PurchaseError('Enter a cancellation reason up to 240 characters.')
    if purchase.status == 'completed':
        if purchase.paid:
            raise PurchaseError('Settle the supplier refund and reverse advance allocations before cancellation.')
        for line in purchase.lines.select_related('product', 'variant', 'batch', 'cost_layer'):
            layer = line.cost_layer
            if not layer or layer.remaining_quantity != line.base_quantity:
                raise PurchaseError(f'{line.product_name} stock has been used, moved, or adjusted; cancellation is unavailable.')
            if StockMovement.objects.filter(business=business, variant=line.variant, location=purchase.location,
                    batch=line.batch, created_at__gt=line.movement.created_at).exclude(reference_id=purchase.pk).exists():
                raise PurchaseError(f'{line.product_name} has later stock activity at this location.')
        entry = JournalEntry.objects.get(business=business, source_type='purchase', source_id=str(purchase.pk))
        reverse(entry, actor, command_id, f'Cancel {purchase.number}: {reason}')
        for line in purchase.lines.select_related('product', 'variant', 'batch', 'cost_layer'):
            balance = StockBalance.objects.select_for_update().get(variant=line.variant,
                location=purchase.location, batch=line.batch)
            if balance.quantity < line.base_quantity:
                raise PurchaseError('Stock balance is too low to reverse this receipt.')
            balance.quantity -= line.base_quantity
            balance.save(update_fields=['quantity', 'updated_at'])
            line.cost_layer.remaining_quantity = 0
            line.cost_layer.save(update_fields=['remaining_quantity'])
            movement = StockMovement.objects.create(business=business, product=line.product,
                variant=line.variant, location=purchase.location, batch=line.batch, type='purchase_cancellation',
                quantity_change=-line.base_quantity, inventory_cost=-line.line_total, unit_name=line.unit_name,
                conversion_factor=line.conversion_factor, reason=reason, reference_id=purchase.pk, actor=actor)
            audit_movement(movement)
    purchase.status, purchase.cancellation_command_id, purchase.cancellation_reason = 'cancelled', command_id, reason
    purchase.save(update_fields=['status', 'cancellation_command_id', 'cancellation_reason'])
    record(business_id=business.pk, actor=actor, entity_type='purchase', entity_id=purchase.pk,
        action='cancelled', subject=purchase.number or 'Draft purchase', changes={'reason': reason})
    return purchase
