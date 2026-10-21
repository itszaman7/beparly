"""Attach historical rows in place. Run while stock writes are paused."""

from decimal import Decimal

from django.db import migrations
from django.db.models import Sum


def backfill(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        # One consistent snapshot; writes wait until the backfill transaction commits.
        schema_editor.execute('LOCK TABLE products_product, products_productunit, products_stockbatch, '
                              'stockkeeper_stockbalance, stockkeeper_costlayer, stockkeeper_stockmovement '
                              'IN ACCESS EXCLUSIVE MODE')
    Product = apps.get_model('products', 'Product')
    Variant = apps.get_model('products', 'ProductVariant')
    Unit = apps.get_model('products', 'ProductUnit')
    Batch = apps.get_model('products', 'StockBatch')
    Balance = apps.get_model('stockkeeper', 'StockBalance')
    Layer = apps.get_model('stockkeeper', 'CostLayer')
    Movement = apps.get_model('stockkeeper', 'StockMovement')
    db = schema_editor.connection.alias

    def totals(model, field):
        return dict(model.objects.using(db).values('product_id').annotate(total=Sum(field)).values_list('product_id', 'total'))

    before = {
        'products': Product.objects.using(db).count(),
        'units': list(Unit.objects.using(db).order_by('pk').values_list('pk', 'product_id', 'name', 'factor', 'selling_price', 'barcode', 'is_active')),
        'batches': list(Batch.objects.using(db).order_by('pk').values_list('pk', 'product_id', 'lot_code', 'manufactured_on', 'expires_on', 'created_at')),
        'balance_rows': list(Balance.objects.using(db).order_by('pk').values_list('pk', 'business_id', 'product_id', 'location_id', 'batch_id', 'quantity', 'updated_at')),
        'layer_rows': list(Layer.objects.using(db).order_by('pk').values_list('pk', 'business_id', 'product_id', 'location_id', 'batch_id', 'received_quantity', 'remaining_quantity', 'unit_cost', 'created_at')),
        'movement_rows': list(Movement.objects.using(db).order_by('pk').values_list('pk', 'business_id', 'product_id', 'location_id', 'batch_id', 'type', 'quantity_change', 'inventory_cost', 'unit_name', 'conversion_factor', 'reason', 'reference_id', 'actor_id', 'created_at')),
        'balances': totals(Balance, 'quantity'),
        'layers': totals(Layer, 'remaining_quantity'),
        'movements': totals(Movement, 'quantity_change'),
        'value': sum((row.remaining_quantity * row.unit_cost for row in Layer.objects.using(db).all().iterator()), Decimal('0')),
        'movement_ids': set(Movement.objects.using(db).values_list('pk', flat=True)),
    }
    for product in Product.objects.using(db).all().iterator():
        variant = Variant.objects.using(db).create(
            product_id=product.pk, business_id=product.business_id, is_default=True,
            sku=product.sku, barcode=product.barcode, base_unit=product.base_unit,
            purchase_price=product.purchase_price, retail_price=product.retail_price,
            wholesale_price=product.wholesale_price, minimum_stock=product.minimum_stock,
            tracking_mode=product.tracking_mode, is_active=product.is_active,
        )
        for model in (Unit, Batch, Balance, Layer, Movement):
            model.objects.using(db).filter(product_id=product.pk).update(variant_id=variant.pk)

    after = {
        'products': Product.objects.using(db).count(),
        'units': list(Unit.objects.using(db).order_by('pk').values_list('pk', 'product_id', 'name', 'factor', 'selling_price', 'barcode', 'is_active')),
        'batches': list(Batch.objects.using(db).order_by('pk').values_list('pk', 'product_id', 'lot_code', 'manufactured_on', 'expires_on', 'created_at')),
        'balance_rows': list(Balance.objects.using(db).order_by('pk').values_list('pk', 'business_id', 'product_id', 'location_id', 'batch_id', 'quantity', 'updated_at')),
        'layer_rows': list(Layer.objects.using(db).order_by('pk').values_list('pk', 'business_id', 'product_id', 'location_id', 'batch_id', 'received_quantity', 'remaining_quantity', 'unit_cost', 'created_at')),
        'movement_rows': list(Movement.objects.using(db).order_by('pk').values_list('pk', 'business_id', 'product_id', 'location_id', 'batch_id', 'type', 'quantity_change', 'inventory_cost', 'unit_name', 'conversion_factor', 'reason', 'reference_id', 'actor_id', 'created_at')),
        'balances': totals(Balance, 'quantity'),
        'layers': totals(Layer, 'remaining_quantity'),
        'movements': totals(Movement, 'quantity_change'),
        'value': sum((row.remaining_quantity * row.unit_cost for row in Layer.objects.using(db).all().iterator()), Decimal('0')),
        'movement_ids': set(Movement.objects.using(db).values_list('pk', flat=True)),
    }
    if before != after:
        raise RuntimeError('Variant backfill changed historical inventory totals or movement IDs.')
    for model in (Unit, Batch, Balance, Layer, Movement):
        if model.objects.using(db).filter(variant_id__isnull=True).exists():
            raise RuntimeError(f'Unmatched {model.__name__} rows after variant backfill.')
    for model in (Unit, Batch, Balance, Layer, Movement):
        for row in model.objects.using(db).select_related('variant').iterator():
            if row.variant.product_id != row.product_id:
                raise RuntimeError(f'Mismatched {model.__name__} product and variant after backfill.')


class Migration(migrations.Migration):
    dependencies = [
        ('products', '0004_product_product_type_product_specifications_and_more'),
        ('stockkeeper', '0005_costlayer_variant_stockbalance_variant_and_more'),
    ]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
