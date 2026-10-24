from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date

from accounting.models import Contact
from accounting.services import amount
from accounts.models import Business, BusinessMember
from audit.services import record
from products.models import Product, ProductUnit
from stockkeeper.models import StockBalance
from stockkeeper.services import business_today, normalize_quantity, resolve_variant, validate_location

from .models import Quotation, QuotationCommand, QuotationLine, QuotationSaleDraft, QuotationSequence, Sale
from .services import create_sale


class QuotationError(ValueError):
    pass


class QuotationConflict(QuotationError):
    pass


def effective_status(quote):
    if quote.status == 'pending' and quote.valid_until and quote.valid_until < business_today(quote.business):
        return 'expired'
    return quote.status


def serialize(quote, lines=True):
    result = {'id': str(quote.pk), 'number': quote.number, 'status': effective_status(quote),
        'stored_status': quote.status, 'version': quote.version, 'customer_id': str(quote.customer_id) if quote.customer_id else None,
        'sale_id': str(quote.completed_sale.pk) if hasattr(quote, 'completed_sale') else None,
        'customer_name': quote.customer_name, 'customer_phone': quote.customer_phone,
        'customer_address': quote.customer_address, 'location_id': quote.location_id, 'location_name': quote.location.name,
        'price_tier': quote.price_tier, 'valid_until': quote.valid_until.isoformat() if quote.valid_until else None,
        'issued_at': quote.issued_at.isoformat() if quote.issued_at else None,
        'delivery_address': quote.delivery_address, 'notes': quote.notes,
        'subtotal': str(quote.subtotal), 'discount': str(quote.discount),
        'delivery_fee': str(quote.delivery_fee), 'total': str(quote.total),
        'created_at': quote.created_at.isoformat(), 'updated_at': quote.updated_at.isoformat()}
    if lines:
        result['lines'] = [{'id': row.pk, 'product_id': str(row.product_id), 'variant_id': str(row.variant_id),
            'unit_id': str(row.unit_id) if row.unit_id else None, 'product_name': row.product_name,
            'variant_name': row.variant_name, 'image_url': row.image_url_snapshot or (
                default_storage.url(row.product.image_key) if quote.status == 'draft' and row.product.image_key else ''),
            'sku': row.sku, 'unit_name': row.unit_name,
            'conversion_factor': str(row.conversion_factor), 'quantity': str(row.quantity),
            'base_quantity': str(row.base_quantity), 'unit_price': str(row.unit_price),
            'line_total': str(row.line_total)} for row in quote.lines.select_related('product').order_by('pk')]
    return result


def _replay(business, command_id, action):
    prior = QuotationCommand.objects.filter(business=business, command_id=command_id).select_related('quotation').first()
    if prior:
        if prior.action != action:
            raise QuotationConflict('This command ID was used for another action.')
        return prior.quotation
    return None


def _record(quote, actor, command_id, action, changes):
    QuotationCommand.objects.create(business=quote.business, command_id=command_id, quotation=quote, action=action)
    record(business_id=quote.business_id, actor=actor, entity_type='quotation', entity_id=quote.pk,
           action=action, subject=quote.number or str(quote.pk), location_id=quote.location_id, changes=changes)


def _clean_draft(business, actor, data):
    if not isinstance(data, dict):
        raise QuotationError('Send quotation details.')
    location = validate_location(business.pk, data.get('location_id'))
    tier = data.get('price_tier', 'retail')
    if tier not in ('retail', 'wholesale'):
        raise QuotationError('Choose retail or wholesale pricing.')
    customer = None
    if data.get('customer_id'):
        customer = Contact.objects.filter(business=business, pk=data['customer_id'], is_customer=True, is_active=True).first()
        if not customer:
            raise QuotationError('Choose an active customer in this business.')
    customer_name = customer.name if customer else str(data.get('customer_name') or 'Walk-in Customer').strip()[:160]
    customer_phone = customer.phone if customer else str(data.get('customer_phone') or '').strip()[:30]
    customer_address = ', '.join(v for v in (customer.address, customer.area, customer.district) if v) if customer else str(data.get('customer_address') or '').strip()[:500]
    raw_lines = data.get('lines')
    if not isinstance(raw_lines, list) or not 1 <= len(raw_lines) <= 100:
        raise QuotationError('Add 1 to 100 products.')
    member = BusinessMember.objects.get(business=business, user=actor)
    lines, subtotal = [], Decimal('0')
    for item in raw_lines:
        if not isinstance(item, dict):
            raise QuotationError('Enter valid product lines.')
        product = Product.objects.filter(business=business, pk=item.get('product_id'), is_active=True).first()
        if not product:
            raise QuotationError('A product is unavailable or belongs to another business.')
        variant = resolve_variant(product, item.get('variant_id'))
        unit = ProductUnit.objects.filter(product=product, variant=variant, pk=item.get('unit_id'), is_active=True).first() if item.get('unit_id') else None
        if item.get('unit_id') and not unit:
            raise QuotationError('Choose an active package unit.')
        quantity = amount(item.get('quantity'), places=3)
        base, factor, unit_name = normalize_quantity(variant, quantity, unit.pk if unit else None)
        catalog_price = unit.selling_price if unit and unit.selling_price is not None else getattr(variant, f'{tier}_price')
        if catalog_price is None and tier == 'wholesale':
            catalog_price = variant.retail_price
        if catalog_price is None:
            raise QuotationError(f'Add a catalog price for {product.name}.')
        catalog_price = amount(catalog_price)
        price = amount(item.get('unit_price') or catalog_price)
        if price != catalog_price and member.role != BusinessMember.OWNER:
            raise QuotationError('Only the owner may set a custom quotation price.')
        total = (quantity * price).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        subtotal += total
        lines.append(dict(product=product, variant=variant, unit=unit, product_name=product.name,
            variant_name=variant.label, image_url_snapshot=default_storage.url(product.image_key) if product.image_key else '',
            sku=variant.sku, unit_name=unit_name, conversion_factor=factor,
            quantity=quantity, base_quantity=base, unit_price=price, line_total=total))
    discount = amount(data.get('discount', '0'), positive=False)
    delivery_fee = amount(data.get('delivery_fee', '0'), positive=False)
    if discount >= subtotal:
        raise QuotationError('Discount must be less than the product subtotal.')
    delivery_address = str(data.get('delivery_address') or '').strip()
    if len(delivery_address) > 500 or (delivery_fee and not delivery_address):
        raise QuotationError('Add a delivery address of at most 500 characters when charging delivery.')
    valid_until = parse_date(str(data['valid_until'])) if data.get('valid_until') else None
    if data.get('valid_until') and not valid_until:
        raise QuotationError('Enter a valid validity date.')
    return dict(customer=customer, customer_name=customer_name, customer_phone=customer_phone,
        customer_address=customer_address, location=location, price_tier=tier,
        valid_until=valid_until, delivery_address=delivery_address, notes=str(data.get('notes') or '').strip()[:2000],
        subtotal=subtotal, discount=discount, delivery_fee=delivery_fee, total=subtotal-discount+delivery_fee), lines


@transaction.atomic
def save_draft(business, actor, command_id, data, quote_id=None):
    Business.objects.select_for_update().get(pk=business.pk)
    prior = _replay(business, command_id, 'saved')
    if prior:
        return prior
    quote = Quotation.objects.select_for_update().filter(business=business, pk=quote_id).first() if quote_id else None
    if quote_id and not quote:
        raise QuotationError('Quotation not found.')
    if quote:
        if quote.status != 'draft':
            raise QuotationError('Duplicate an issued quotation to revise it.')
        if data.get('version') != quote.version:
            raise QuotationConflict('This draft changed on another device. Review its latest version before saving.')
    fields, lines = _clean_draft(business, actor, data)
    if quote:
        for key, value in fields.items():
            setattr(quote, key, value)
        quote.version += 1
        quote.save()
        quote.lines.all().delete()
    else:
        quote = Quotation.objects.create(business=business, actor=actor, **fields)
    QuotationLine.objects.bulk_create([QuotationLine(quotation=quote, **line) for line in lines])
    _record(quote, actor, command_id, 'saved', {'version': quote.version, 'total': str(quote.total)})
    return quote


@transaction.atomic
def issue(business, actor, command_id, quote_id, version):
    Business.objects.select_for_update().get(pk=business.pk)
    prior = _replay(business, command_id, 'issued')
    if prior:
        return prior
    quote = Quotation.objects.select_for_update().get(business=business, pk=quote_id)
    if quote.status != 'draft':
        raise QuotationError('Only a draft may be issued.')
    if quote.version != version:
        raise QuotationConflict('The draft changed. Review its latest version before issuing.')
    today = business_today(business)
    if quote.valid_until and quote.valid_until < today:
        raise QuotationError('Validity date cannot be in the past.')
    for line in quote.lines.select_related('product').filter(image_url_snapshot=''):
        if line.product.image_key:
            line.image_url_snapshot = default_storage.url(line.product.image_key)
            line.save(update_fields=['image_url_snapshot'])
    sequence, _ = QuotationSequence.objects.select_for_update().get_or_create(business=business)
    sequence.value += 1
    sequence.save(update_fields=['value'])
    quote.number = f'Q-{sequence.value:03d}'
    quote.valid_until = quote.valid_until or today + timedelta(days=7)
    quote.issued_at = timezone.now()
    quote.status = 'pending'
    quote.version += 1
    quote.save()
    _record(quote, actor, command_id, 'issued', {'number': quote.number, 'total': str(quote.total)})
    return quote


@transaction.atomic
def change_status(business, actor, command_id, quote_id, status):
    Business.objects.select_for_update().get(pk=business.pk)
    prior = _replay(business, command_id, f'status:{status}')
    if prior:
        return prior
    quote = Quotation.objects.select_for_update().get(business=business, pk=quote_id)
    if status not in ('accepted', 'rejected', 'cancelled'):
        raise QuotationError('Choose accepted, rejected, or cancelled.')
    if effective_status(quote) != 'pending':
        raise QuotationError('Only a pending, unexpired quotation can change status.')
    quote.status = status
    if status == 'accepted':
        quote.accepted_at = timezone.now()
    quote.save(update_fields=['status', 'accepted_at', 'updated_at'])
    _record(quote, actor, command_id, f'status:{status}', {'status': status})
    return quote


@transaction.atomic
def duplicate(business, actor, command_id, quote_id):
    Business.objects.select_for_update().get(pk=business.pk)
    prior = _replay(business, command_id, 'duplicated')
    if prior:
        return prior
    source = Quotation.objects.get(business=business, pk=quote_id)
    quote = Quotation.objects.create(business=business, actor=actor, source_quotation=source,
        customer=source.customer, customer_name=source.customer_name, customer_phone=source.customer_phone,
        customer_address=source.customer_address, location=source.location, price_tier=source.price_tier,
        delivery_address=source.delivery_address, notes=source.notes, subtotal=source.subtotal,
        discount=source.discount, delivery_fee=source.delivery_fee, total=source.total)
    QuotationLine.objects.bulk_create([QuotationLine(quotation=quote, product=row.product, variant=row.variant,
        unit=row.unit, product_name=row.product_name, variant_name=row.variant_name,
        image_url_snapshot=row.image_url_snapshot, sku=row.sku,
        unit_name=row.unit_name, conversion_factor=row.conversion_factor, quantity=row.quantity,
        base_quantity=row.base_quantity, unit_price=row.unit_price, line_total=row.line_total) for row in source.lines.order_by('pk')])
    _record(quote, actor, command_id, 'duplicated', {'source': str(source.pk)})
    return quote


def check_availability(quote):
    validate_location(quote.business_id, quote.location_id)
    required = {}
    for row in quote.lines.select_related('product', 'variant', 'unit').order_by('pk'):
        if not row.product.is_active or not row.variant.is_active or row.variant.product_id != row.product_id:
            raise QuotationError(f'{row.product_name} is no longer active. Duplicate and revise this quotation.')
        if row.unit_id and (not row.unit.is_active or row.unit.variant_id != row.variant_id or row.unit.factor != row.conversion_factor):
            raise QuotationError(f'The package factor for {row.product_name} changed. Duplicate and revise this quotation.')
        if not row.unit_id and row.variant.base_unit != row.unit_name:
            raise QuotationError(f'The base unit for {row.product_name} changed. Duplicate and revise this quotation.')
        required[row.variant_id] = (required.get(row.variant_id, (Decimal('0'), row.product_name))[0] + row.base_quantity, row.product_name)
    for variant_id, (quantity, name) in required.items():
        available = StockBalance.objects.filter(business=quote.business, location=quote.location, variant_id=variant_id).filter(
            Q(batch__isnull=True) | Q(batch__expires_on__isnull=True) | Q(batch__expires_on__gte=business_today(quote.business))).aggregate(q=Sum('quantity'))['q'] or Decimal('0')
        if available < quantity:
            raise QuotationError(f'Insufficient stock for {name} at {quote.location.name}. Replenish stock before checkout.')


@transaction.atomic
def convert(business, actor, command_id, quote_id):
    Business.objects.select_for_update().get(pk=business.pk)
    prior = _replay(business, command_id, 'converted')
    if prior:
        return prior.sale_draft
    quote = Quotation.objects.select_for_update().get(business=business, pk=quote_id)
    if quote.status != 'accepted':
        raise QuotationError('Accept this quotation before converting it.')
    draft = QuotationSaleDraft.objects.filter(quotation=quote).first()
    if draft:
        if not Sale.objects.filter(quotation=quote).exists():
            check_availability(quote)
        _record(quote, actor, command_id, 'converted', {'sale_draft': str(draft.pk)})
        return draft
    check_availability(quote)
    payload = {'mode': 'manual', 'price_tier': quote.price_tier, 'location_id': quote.location_id,
        'customer_id': str(quote.customer_id) if quote.customer_id else None,
        'discount': str(quote.discount), 'delivery_fee': str(quote.delivery_fee),
        'delivery_address': quote.delivery_address, 'notes': quote.notes,
        'lines': [{'product_id': str(row.product_id), 'variant_id': str(row.variant_id),
            'unit_id': str(row.unit_id) if row.unit_id else None, 'quantity': str(row.quantity),
            'unit_price': str(row.unit_price)} for row in quote.lines.order_by('pk')]}
    draft = QuotationSaleDraft.objects.create(quotation=quote, business=business, payload=payload)
    _record(quote, actor, command_id, 'converted', {'sale_draft': str(draft.pk)})
    return draft


@transaction.atomic
def complete_draft(business, actor, command_id, draft_id, data):
    Business.objects.select_for_update().get(pk=business.pk)
    draft = QuotationSaleDraft.objects.select_for_update().select_related('quotation').get(business=business, pk=draft_id)
    existing = Sale.objects.filter(business=business, command_id=command_id).first()
    if existing:
        if existing.quotation_id != draft.quotation_id:
            raise QuotationConflict('This checkout command was used for another sale.')
        return existing
    if Sale.objects.filter(quotation=draft.quotation).exists():
        raise QuotationConflict('This quotation was already completed as a sale.')
    check_availability(draft.quotation)
    if not isinstance(data, dict) or set(data) - {'paid', 'account_id', 'customer_id', 'batch_ids', 'prices'}:
        raise QuotationError('Send payment choices and optional batch selections.')
    payload = dict(draft.payload)
    payload['lines'] = [dict(row) for row in payload['lines']]
    if data.get('customer_id'):
        payload['customer_id'] = data['customer_id']
    if data.get('batch_ids'):
        if not isinstance(data['batch_ids'], list) or len(data['batch_ids']) != len(payload['lines']):
            raise QuotationError('Choose a batch for each quoted item.')
        for row, batch_id in zip(payload['lines'], data['batch_ids']):
            row['batch_id'] = batch_id
    if data.get('prices'):
        member = BusinessMember.objects.get(business=business, user=actor)
        if member.role != BusinessMember.OWNER or len(data['prices']) != len(payload['lines']):
            raise QuotationError('Only the owner may revise quoted prices at checkout.')
        for row, price in zip(payload['lines'], data['prices']):
            row['unit_price'] = str(amount(price))
    payload['paid'] = data.get('paid', '0')
    payload['account_id'] = data.get('account_id')
    sale = create_sale(business, actor, command_id, payload, quotation=draft.quotation)
    _record(draft.quotation, actor, command_id, 'completed', {'sale': str(sale.pk)})
    return sale
