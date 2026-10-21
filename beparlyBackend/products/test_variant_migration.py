import uuid
from decimal import Decimal

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from accounts.models import Business, User
from audit.models import AuditEvent


class VariantBackfillTests(TransactionTestCase):
    """Exercise the staged migration with populated historical tables."""

    def test_existing_stock_history_is_attached_without_reposting(self):
        executor = MigrationExecutor(connection)
        old = [('products', '0003_stockbatch_unique_product_lot_no_expiry'),
               ('stockkeeper', '0004_remove_stockbalance_unique_simple_stock_balance_and_more')]
        executor.migrate(old)
        apps = executor.loader.project_state(old).apps
        Product = apps.get_model('products', 'Product')
        Batch = apps.get_model('products', 'StockBatch')
        Balance = apps.get_model('stockkeeper', 'StockBalance')
        Layer = apps.get_model('stockkeeper', 'CostLayer')
        Movement = apps.get_model('stockkeeper', 'StockMovement')
        user = User.objects.create_user(phone='01777777777', password='ExamplePass#83')
        business = Business.objects.create(name='Migration Shop')
        from stockkeeper.models import StockLocation
        location = StockLocation.objects.get(business=business, is_default=True)
        product = Product.objects.create(business_id=business.pk, name='Old item', sku='OLD-1',
                                         base_unit='Piece', tracking_mode='expiry')
        batch = Batch.objects.create(product_id=product.pk, lot_code='LOT-1', expires_on='2027-10-01')
        balance = Balance.objects.create(business_id=business.pk, product_id=product.pk,
                                         location_id=location.pk, batch_id=batch.pk, quantity=Decimal('15'))
        layer = Layer.objects.create(business_id=business.pk, product_id=product.pk, location_id=location.pk,
                                     batch_id=batch.pk, received_quantity=Decimal('15'),
                                     remaining_quantity=Decimal('15'), unit_cost=Decimal('11.25'))
        movement_id = uuid.uuid4()
        Movement.objects.create(id=movement_id, business_id=business.pk, product_id=product.pk,
                                location_id=location.pk, batch_id=batch.pk, type='opening',
                                quantity_change=Decimal('15'), inventory_cost=Decimal('168.75'),
                                actor_id=user.pk, reference_id=uuid.uuid4())
        event = AuditEvent.objects.create(business_id=business.pk, actor=user, entity_type='product',
                                          entity_id=str(product.pk), subject='Old item', action='created')
        balance.refresh_from_db(); layer.refresh_from_db(); batch.refresh_from_db()
        before = (balance.pk, balance.quantity, layer.pk, layer.remaining_quantity,
                  layer.unit_cost, movement_id, batch.pk, batch.expires_on, event.pk)
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        new = executor.loader.project_state(executor.loader.graph.leaf_nodes()).apps
        Variant = new.get_model('products', 'ProductVariant')
        new_balance = new.get_model('stockkeeper', 'StockBalance').objects.get(pk=balance.pk)
        new_layer = new.get_model('stockkeeper', 'CostLayer').objects.get(pk=layer.pk)
        new_movement = new.get_model('stockkeeper', 'StockMovement').objects.get(pk=movement_id)
        new_batch = new.get_model('products', 'StockBatch').objects.get(pk=batch.pk)
        variant = Variant.objects.get(product_id=product.pk, is_default=True)
        self.assertEqual((new_balance.pk, new_balance.quantity, new_layer.pk, new_layer.remaining_quantity,
                          new_layer.unit_cost, new_movement.pk, new_batch.pk, new_batch.expires_on,
                          AuditEvent.objects.get(pk=event.pk).pk), before)
        self.assertEqual({new_balance.variant_id, new_layer.variant_id, new_movement.variant_id,
                          new_batch.variant_id}, {variant.pk})
