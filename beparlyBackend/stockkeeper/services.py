from datetime import timedelta
from decimal import Decimal
from audit.services import record
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from accounts.models import Business
from products.models import ProductUnit, ProductVariant

from .models import CostLayer, StockBalance, StockCommand, StockLocation, StockMovement


class StockError(ValueError):
    pass


def financial_stock_movement(movement, cause):
    from accounting.services import ensure_inventory_cutoff, ledger, post, dr, cr
    business = movement.product.business
    ensure_inventory_cutoff(business)
    value = abs(movement.inventory_cost)
    if not value:
        return
    if movement.quantity_change > 0:
        credit_code = {'opening': 'OPENING', 'owner_contribution': 'CAPITAL',
                       'count_gain': 'INVENTORY_GAIN'}.get(cause)
        if not credit_code:
            raise StockError('Choose owner contribution or inventory count gain.')
        lines = [dr(ledger(business, 'INVENTORY'), value), cr(ledger(business, credit_code), value)]
    else:
        debit_code = 'OPENING' if cause == 'opening_correction' else 'INVENTORY_LOSS'
        lines = [dr(ledger(business, debit_code), value), cr(ledger(business, 'INVENTORY'), value)]
    post(business, 'stock_movement', movement.pk, f'{movement.type}: {movement.product.name}', lines,
         actor=movement.actor, event_date=business_today(business))


def audit_movement(movement):
    record(business_id=movement.business_id, actor=movement.actor,
           entity_type='stock', entity_id=movement.pk, subject=movement.product.name,
           product_id=movement.product_id,
           location_id=movement.location_id, action=movement.type,
           reference_id=movement.reference_id,
           changes={'quantity_change': str(movement.quantity_change),
                    'inventory_cost': str(movement.inventory_cost),
                    'location': movement.location.name,
                    'batch': movement.batch.lot_code if movement.batch_id else None,
                    'reason': movement.reason})


def validate_location(business_id, location_id=None):
    query = StockLocation.objects.filter(business_id=business_id, is_active=True)
    location = query.filter(pk=location_id).first() if location_id else query.filter(is_default=True).first()
    if not location:
        raise StockError('Choose an active stock location.')
    return location


def business_today(business):
    return timezone.localtime(timezone.now(), ZoneInfo(business.timezone)).date()


def resolve_variant(product, variant_id=None):
    if variant_id:
        variant = ProductVariant.objects.filter(product=product, business_id=product.business_id, pk=variant_id).first()
        if not variant:
            raise StockError('Choose a variant of this product.')
    elif product.product_type == 'simple':
        variant = ProductVariant.objects.filter(product=product, is_default=True).first()
    else:
        raise StockError('Choose a variant for this product.')
    if not variant or not variant.is_active:
        raise StockError('Choose an active variant.')
    return variant


def normalize_quantity(variant, quantity, unit_id=None):
    factor = Decimal('1')
    unit_name = variant.base_unit
    if unit_id:
        unit = ProductUnit.objects.filter(variant=variant, pk=unit_id, is_active=True).first()
        if not unit:
            raise StockError('Choose an active packaging unit for this product.')
        factor, unit_name = unit.factor, unit.name
    base = quantity * factor
    if base <= 0 or base != base.quantize(Decimal('0.001')):
        raise StockError('Quantity conversion must result in a positive base-unit quantity with at most three decimal places.')
    return base, factor, unit_name


def validate_batch(variant, batch):
    if variant.tracking_mode == 'simple' and batch:
        raise StockError('This product does not use batches.')
    if variant.tracking_mode != 'simple' and (not batch or batch.variant_id != variant.pk):
        raise StockError('Choose a batch for this product.')
    if variant.tracking_mode == 'expiry' and not batch.expires_on:
        raise StockError('This product requires an expiry date.')


@transaction.atomic
def receive(product, location, quantity, unit_cost, actor, reference_id, movement_type='opening', reason='', batch=None, unit_id=None, variant=None, financial_reason=None, post_inventory_journal=True):
    if product.business_id != location.business_id:
        raise StockError('Product and location must belong to the same business.')
    variant = variant or resolve_variant(product)
    validate_batch(variant, batch)
    base, factor, unit_name = normalize_quantity(variant, quantity, unit_id)
    if unit_cost < 0:
        raise StockError('Cost cannot be negative.')
    from accounting.services import ensure_inventory_cutoff
    ensure_inventory_cutoff(product.business)
    balance, _ = StockBalance.objects.select_for_update().get_or_create(
        business_id=product.business_id, product=product, variant=variant, location=location, batch=batch,
        defaults={'quantity': Decimal('0')})
    balance.quantity += base
    balance.save(update_fields=['quantity', 'updated_at'])
    CostLayer.objects.create(business_id=product.business_id, product=product, variant=variant, location=location, batch=batch,
                             received_quantity=base, remaining_quantity=base, unit_cost=unit_cost)
    movement = StockMovement.objects.create(business_id=product.business_id, product=product, variant=variant, location=location,
                                        batch=batch, type=movement_type, quantity_change=base,
                                        inventory_cost=base * unit_cost, unit_name=unit_name,
                                        conversion_factor=factor, actor=actor,
                                        reference_id=reference_id, reason=reason)
    audit_movement(movement)
    if post_inventory_journal:
        financial_stock_movement(movement, financial_reason or ('opening' if movement_type == 'opening' else 'count_gain'))
    return movement


def consume(product, variant, location, base, batch):
    balance = StockBalance.objects.select_for_update().filter(variant=variant, location=location, batch=batch).first()
    if not balance or balance.quantity < base:
        raise StockError('Insufficient stock at this location.')
    balance.quantity -= base
    balance.save(update_fields=['quantity', 'updated_at'])
    left, cost, portions = base, Decimal('0'), []
    layers = CostLayer.objects.select_for_update().filter(variant=variant, location=location, batch=batch,
                                                           remaining_quantity__gt=0).order_by('created_at', 'id')
    for layer in layers:
        taken = min(left, layer.remaining_quantity)
        layer.remaining_quantity -= taken
        layer.save(update_fields=['remaining_quantity'])
        portions.append((taken, layer.unit_cost))
        cost += taken * layer.unit_cost
        left -= taken
        if left == 0:
            break
    if left:
        raise StockError('Stock cost layers do not reconcile with the balance.')
    return cost, portions


def manual_receive(product, location, quantity, unit_cost, actor, command_id, reason, batch=None, unit_id=None, variant=None, financial_reason=None):
    with transaction.atomic():
        Business.objects.select_for_update().get(pk=product.business_id)
        prior = StockCommand.objects.filter(business_id=product.business_id, command_id=command_id).first()
        if prior:
            return prior.result
        if financial_reason not in ('owner_contribution', 'count_gain'):
            raise StockError('Choose why stock was added.')
        variant = variant or resolve_variant(product)
        movement = receive(product, location, quantity, unit_cost, actor, command_id, 'manual_receipt', reason, batch, unit_id, variant, financial_reason)
        result = {'movement_id': str(movement.pk), 'product_id': str(product.pk), 'variant_id': str(variant.pk), 'quantity_change': str(movement.quantity_change)}
        StockCommand.objects.create(business_id=product.business_id, command_id=command_id, result=result)
        return result


def post_waste(product, location, quantity, actor, command_id, reason, batch=None, unit_id=None, variant=None):
    with transaction.atomic():
        Business.objects.select_for_update().get(pk=product.business_id)
        prior = StockCommand.objects.filter(business_id=product.business_id, command_id=command_id).first()
        if prior:
            return prior.result
        from accounting.services import ensure_inventory_cutoff
        ensure_inventory_cutoff(product.business)
        variant = variant or resolve_variant(product)
        validate_batch(variant, batch)
        base, factor, unit_name = normalize_quantity(variant, quantity, unit_id)
        cost, _ = consume(product, variant, location, base, batch)
        movement = StockMovement.objects.create(business_id=product.business_id, product=product, variant=variant,
            location=location, batch=batch, type='waste', quantity_change=-base, inventory_cost=-cost,
            unit_name=unit_name, conversion_factor=factor, reason=reason, actor=actor, reference_id=command_id)
        audit_movement(movement)
        financial_stock_movement(movement, 'loss')
        result = {'movement_id': str(movement.pk), 'product_id': str(product.pk), 'variant_id': str(variant.pk), 'quantity_change': str(movement.quantity_change), 'inventory_cost': str(cost)}
        StockCommand.objects.create(business_id=product.business_id, command_id=command_id, result=result)
        return result


def post_adjustment(product, location, quantity, increase, actor, command_id, reason, unit_cost=None, batch=None, unit_id=None, variant=None, financial_reason=None, opening_movement=None):
    with transaction.atomic():
        Business.objects.select_for_update().get(pk=product.business_id)
        prior = StockCommand.objects.filter(business_id=product.business_id, command_id=command_id).first()
        if prior:
            return prior.result
        if financial_reason not in (('owner_contribution', 'count_gain') if increase else ('shortage', 'opening_correction')):
            raise StockError('Choose a financial reason that matches this stock change.')
        from accounting.services import ensure_inventory_cutoff
        ensure_inventory_cutoff(product.business)
        variant = variant or resolve_variant(product)
        if increase:
            if not product.is_active:
                raise StockError('Reactivate this product before adding stock.')
            if unit_cost is None:
                raise StockError('Enter the actual unit cost for added stock.')
            movement = receive(product, location, quantity, unit_cost, actor, command_id, 'adjustment', reason, batch, unit_id, variant, financial_reason)
        else:
            validate_batch(variant, batch)
            base, factor, unit_name = normalize_quantity(variant, quantity, unit_id)
            if financial_reason == 'opening_correction':
                if (not opening_movement or opening_movement.business_id != product.business_id or
                        opening_movement.product_id != product.pk or opening_movement.variant_id != variant.pk or
                        opening_movement.location_id != location.pk or opening_movement.batch_id != (batch.pk if batch else None) or
                        opening_movement.type != 'opening' or base > opening_movement.quantity_change or
                        StockMovement.objects.filter(variant=variant, location=location, batch=batch,
                            created_at__gte=opening_movement.created_at).exclude(pk=opening_movement.pk).exclude(type='tracking_conversion').exists()):
                    raise StockError('Opening correction must refer to unchanged opening stock at this location and batch.')
            cost, _ = consume(product, variant, location, base, batch)
            movement = StockMovement.objects.create(business_id=product.business_id, product=product, variant=variant,
                location=location, batch=batch, type='adjustment', quantity_change=-base,
                inventory_cost=-cost, unit_name=unit_name, conversion_factor=factor,
                reason=reason, actor=actor, reference_id=command_id, opening_movement=opening_movement)
            audit_movement(movement)
            financial_stock_movement(movement, financial_reason)
        result = {'movement_id': str(movement.pk), 'product_id': str(product.pk), 'variant_id': str(variant.pk), 'quantity_change': str(movement.quantity_change)}
        StockCommand.objects.create(business_id=product.business_id, command_id=command_id, result=result)
        return result


def post_transfer(product, source, destination, quantity, actor, command_id, batch=None, unit_id=None, variant=None):
    if source.pk == destination.pk:
        raise StockError('Choose a different destination location.')
    with transaction.atomic():
        Business.objects.select_for_update().get(pk=product.business_id)
        prior = StockCommand.objects.filter(business_id=product.business_id, command_id=command_id).first()
        if prior:
            return prior.result
        variant = variant or resolve_variant(product)
        validate_batch(variant, batch)
        base, factor, unit_name = normalize_quantity(variant, quantity, unit_id)
        cost, portions = consume(product, variant, source, base, batch)
        target, _ = StockBalance.objects.select_for_update().get_or_create(
            business_id=product.business_id, product=product, variant=variant, location=destination, batch=batch,
            defaults={'quantity': Decimal('0')})
        target.quantity += base
        target.save(update_fields=['quantity', 'updated_at'])
        for moved, unit_cost in portions:
            CostLayer.objects.create(business_id=product.business_id, product=product, variant=variant, location=destination,
                                     batch=batch, received_quantity=moved, remaining_quantity=moved, unit_cost=unit_cost)
        for location, change, value in ((source, -base, -cost), (destination, base, cost)):
            movement = StockMovement.objects.create(business_id=product.business_id, product=product, variant=variant, location=location,
                batch=batch, type='transfer', quantity_change=change, inventory_cost=value,
                unit_name=unit_name, conversion_factor=factor, actor=actor, reference_id=command_id)
            audit_movement(movement)
        result = {'reference_id': str(command_id), 'product_id': str(product.pk), 'variant_id': str(variant.pk), 'quantity': str(base), 'inventory_cost': str(cost)}
        StockCommand.objects.create(business_id=product.business_id, command_id=command_id, result=result)
        return result


def stock_summary(product, variant=None):
    balances = list(StockBalance.objects.filter(variant=variant).select_related('location', 'batch', 'variant').order_by('location__name')) if variant else list(StockBalance.objects.filter(product=product).select_related('location', 'batch', 'variant').order_by('location__name'))
    today = business_today(product.business)
    physical = sum((row.quantity for row in balances), Decimal('0'))
    sellable = sum((row.quantity for row in balances if not row.batch or not row.batch.expires_on or row.batch.expires_on >= today), Decimal('0'))
    expiring = sum((row.quantity for row in balances if row.batch and row.batch.expires_on and today <= row.batch.expires_on <= today + timedelta(days=product.business.expiry_warning_days)), Decimal('0'))
    layers = CostLayer.objects.filter(variant=variant, remaining_quantity__gt=0) if variant else CostLayer.objects.filter(product=product, remaining_quantity__gt=0)
    value = sum((layer.remaining_quantity * layer.unit_cost for layer in layers), Decimal('0'))
    locations = {}
    for row in balances:
        item = locations.setdefault(row.location_id, {'id': row.location_id, 'name': row.location.name, 'quantity': Decimal('0')})
        item['quantity'] += row.quantity
    result = {'physical': str(physical), 'sellable': str(sellable), 'inventory_value': str(value), 'expired': str(physical - sellable),
            'expiring_soon': str(expiring),
            'locations': [{'id': item['id'], 'name': item['name'], 'quantity': str(item['quantity'])} for item in locations.values()]}
    if variant is None and product.product_type == 'variant':
        units = set(product.variants.filter(is_active=True).values_list('base_unit', flat=True))
        grouped = {}
        for row in balances:
            unit = row.variant.base_unit
            item = grouped.setdefault(unit, {'physical': Decimal('0'), 'sellable': Decimal('0')})
            item['physical'] += row.quantity
            if not row.batch or not row.batch.expires_on or row.batch.expires_on >= today:
                item['sellable'] += row.quantity
        result['stock_by_unit'] = [{'unit': unit, 'quantity': str(amounts['sellable']),
                                    'physical': str(amounts['physical'])} for unit, amounts in sorted(grouped.items())]
        if len(units) > 1:
            for key in ('physical', 'sellable', 'expired', 'expiring_soon', 'locations'):
                result[key] = None
    return result


def fefo_batches(product, location, variant=None):
    variant = variant or resolve_variant(product)
    today = business_today(product.business)
    from django.db.models import Q
    return list(StockBalance.objects.filter(variant=variant, location=location, quantity__gt=0,
        batch__isnull=False).filter(Q(batch__expires_on__gte=today) | Q(batch__expires_on__isnull=True))
        .select_related('batch').order_by('batch__expires_on', 'batch__created_at').values_list('batch_id', flat=True))


def validate_sale_batch(product, location, batch, quantity, variant=None):
    variant = variant or resolve_variant(product)
    validate_batch(variant, batch)
    if batch and batch.expires_on and batch.expires_on < business_today(product.business):
        raise StockError('Expired batches cannot be selected for an ordinary sale.')
    base, _, _ = normalize_quantity(variant, quantity)
    available = StockBalance.objects.filter(variant=variant, location=location, batch=batch).values_list('quantity', flat=True).first() or 0
    if available < base:
        raise StockError('Insufficient sellable stock in this batch.')
    return base


def convert_tracking(product, target_mode, actor, command_id, lot_code='', expires_on=None, variant=None):
    from products.models import Product, StockBatch
    if target_mode not in (Product.SIMPLE, Product.BATCH, Product.EXPIRY):
        raise StockError('Choose a valid stock tracking mode.')
    with transaction.atomic():
        Business.objects.select_for_update().get(pk=product.business_id)
        prior = StockCommand.objects.filter(business_id=product.business_id, command_id=command_id).first()
        if prior:
            return prior.result
        product = Product.objects.select_for_update().get(pk=product.pk)
        variant = resolve_variant(product, variant.pk if variant else None)
        original = variant.tracking_mode
        if original == target_mode:
            raise StockError('Tracking mode is already set.')
        balances = list(StockBalance.objects.select_for_update(of=('self',)).filter(variant=variant).select_related('batch', 'location'))
        active = [row for row in balances if row.quantity > 0]
        if original == Product.SIMPLE and target_mode != Product.SIMPLE:
            if active and (not lot_code.strip() or target_mode == Product.EXPIRY and not expires_on):
                raise StockError('Enter a batch identifier and expiry date for existing stock.')
            batch = StockBatch.objects.create(product=product, variant=variant, lot_code=lot_code.strip(), expires_on=expires_on) if active else None
            if batch:
                StockBalance.objects.filter(variant=variant, batch__isnull=True).update(batch=batch)
                CostLayer.objects.filter(variant=variant, batch__isnull=True, remaining_quantity__gt=0).update(batch=batch)
        elif target_mode == Product.SIMPLE:
            if any(row.batch and row.batch.expires_on and row.batch.expires_on < business_today(product.business) for row in active):
                raise StockError('Dispose of expired physical stock before removing expiry tracking.')
            for row in balances:
                if not row.batch_id:
                    continue
                simple, _ = StockBalance.objects.select_for_update().get_or_create(
                    business_id=product.business_id, product=product, variant=variant, location=row.location, batch=None,
                    defaults={'quantity': Decimal('0')})
                simple.quantity += row.quantity
                simple.save(update_fields=['quantity', 'updated_at'])
                row.delete()
            CostLayer.objects.filter(variant=variant, remaining_quantity__gt=0).update(batch=None)
        elif target_mode == Product.EXPIRY:
            if any(not row.batch or not row.batch.expires_on for row in active):
                raise StockError('Add expiry dates to every batch with physical stock first.')
        if product.product_type == 'simple':
            product.tracking_mode = target_mode
            product.save(update_fields=['tracking_mode', 'updated_at'])
        variant.tracking_mode = target_mode
        variant.save(update_fields=['tracking_mode', 'updated_at'])
        record(business_id=product.business_id, actor=actor, entity_type='variant' if product.product_type == 'variant' else 'product',
               entity_id=variant.pk if product.product_type == 'variant' else product.pk, subject=variant.label or product.name, product_id=product.pk, action='tracking_changed',
               reference_id=command_id,
               changes={'tracking_mode': {'before': original, 'after': target_mode}})
        for location_id in {row.location_id for row in active}:
            StockMovement.objects.create(business_id=product.business_id, product=product, variant=variant,
                location_id=location_id, type='tracking_conversion', quantity_change=0,
                inventory_cost=0, actor=actor, reference_id=command_id,
                reason=f'{original} to {target_mode}')
        result = {'product_id': str(product.pk), 'variant_id': str(variant.pk), 'tracking_mode': target_mode}
        StockCommand.objects.create(business_id=product.business_id, command_id=command_id, result=result)
        return result
