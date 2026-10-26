"""Exact, business-scoped sellable barcode identity."""
from .models import Product, ProductUnit, ProductVariant


class BarcodeConflict(ValueError):
    pass


def normalize_barcode(value):
    return str(value or '').strip().casefold()


def generated_barcode(identifier):
    """Compact numeric Code 128 identity that fits a 50 mm product label."""
    return f'B-{identifier.int % 10**14:014d}'


def assert_barcode_available(business_id, value, *, product_id=None, variant_id=None, unit_id=None):
    code = normalize_barcode(value)
    if not code:
        return
    variants = ProductVariant.objects.filter(business_id=business_id, barcode__iexact=code)
    products = Product.objects.filter(business_id=business_id, barcode__iexact=code)
    units = ProductUnit.objects.filter(variant__business_id=business_id, barcode__iexact=code)
    if product_id:
        # The default variant intentionally mirrors its simple product barcode.
        products = products.exclude(pk=product_id)
        variants = variants.exclude(product_id=product_id, is_default=True)
    if variant_id:
        variants = variants.exclude(pk=variant_id)
    if unit_id:
        units = units.exclude(pk=unit_id)
    if products.exists() or variants.exists() or units.exists():
        raise BarcodeConflict('Barcode already belongs to another product, variant or package in this business.')


def exact_barcode_target(business_id, value):
    code = normalize_barcode(value)
    if not code or len(code) > 100:
        return None
    variants = list(ProductVariant.objects.filter(business_id=business_id, barcode__iexact=code,
        is_active=True, product__is_active=True).select_related('product')[:2])
    units = list(ProductUnit.objects.filter(variant__business_id=business_id, barcode__iexact=code,
        is_active=True, variant__is_active=True, product__is_active=True).select_related('variant__product')[:2])
    if len(variants) + len(units) > 1:
        raise BarcodeConflict('This barcode matches more than one active item. Correct the catalog before scanning.')
    if variants:
        return variants[0], None
    if units:
        return units[0].variant, units[0]
    return None
