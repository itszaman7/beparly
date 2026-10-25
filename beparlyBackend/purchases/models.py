import uuid
from django.db import models
from django.db.models import Q


class PurchaseSequence(models.Model):
    id = models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')
    business = models.OneToOneField('accounts.Business', on_delete=models.PROTECT)
    value = models.PositiveIntegerField(default=0)


class Purchase(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    supplier = models.ForeignKey('accounting.Contact', on_delete=models.PROTECT)
    location = models.ForeignKey('stockkeeper.StockLocation', on_delete=models.PROTECT)
    number = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=12, default='draft')
    supplier_name = models.CharField(max_length=160, blank=True)
    supplier_phone = models.CharField(max_length=20, blank=True)
    supplier_address = models.CharField(max_length=255, blank=True)
    location_name = models.CharField(max_length=160, blank=True)
    notes = models.TextField(blank=True)
    total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    paid = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    create_command_id = models.UUIDField()
    completion_command_id = models.UUIDField(null=True, blank=True)
    cancellation_command_id = models.UUIDField(null=True, blank=True)
    cancellation_reason = models.CharField(max_length=240, blank=True)
    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['business', 'create_command_id'], name='unique_purchase_create_command'),
            models.UniqueConstraint(fields=['business', 'completion_command_id'], condition=Q(completion_command_id__isnull=False), name='unique_purchase_complete_command'),
            models.UniqueConstraint(fields=['business', 'cancellation_command_id'], condition=Q(cancellation_command_id__isnull=False), name='unique_purchase_cancel_command'),
            models.UniqueConstraint(fields=['business', 'number'], condition=~Q(number=''), name='unique_purchase_number'),
        ]


class PurchaseLine(models.Model):
    id = models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')
    purchase = models.ForeignKey(Purchase, on_delete=models.PROTECT, related_name='lines')
    product = models.ForeignKey('products.Product', on_delete=models.PROTECT)
    variant = models.ForeignKey('products.ProductVariant', on_delete=models.PROTECT)
    unit = models.ForeignKey('products.ProductUnit', null=True, blank=True, on_delete=models.PROTECT)
    batch = models.ForeignKey('products.StockBatch', null=True, blank=True, on_delete=models.PROTECT)
    product_name = models.CharField(max_length=180, blank=True)
    variant_name = models.CharField(max_length=180, blank=True)
    sku = models.CharField(max_length=64, blank=True)
    unit_name = models.CharField(max_length=40, blank=True)
    lot_code = models.CharField(max_length=100, blank=True)
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    base_quantity = models.DecimalField(max_digits=18, decimal_places=3, default=0)
    conversion_factor = models.DecimalField(max_digits=18, decimal_places=3, default=1)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=4)
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    movement = models.OneToOneField('stockkeeper.StockMovement', null=True, blank=True, on_delete=models.PROTECT)
    cost_layer = models.OneToOneField('stockkeeper.CostLayer', null=True, blank=True, on_delete=models.PROTECT)


class OpeningPayable(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    supplier = models.ForeignKey('accounting.Contact', on_delete=models.PROTECT)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    paid = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    command_id = models.UUIDField()
    journal = models.OneToOneField('accounting.JournalEntry', on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'command_id'], name='unique_opening_payable_command')]


class SupplierOperation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    supplier = models.ForeignKey('accounting.Contact', on_delete=models.PROTECT)
    purchase = models.ForeignKey(Purchase, null=True, blank=True, on_delete=models.PROTECT, related_name='operations')
    opening = models.ForeignKey(OpeningPayable, null=True, blank=True, on_delete=models.PROTECT, related_name='operations')
    kind = models.CharField(max_length=24)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    account = models.ForeignKey('accounting.MoneyAccount', null=True, blank=True, on_delete=models.PROTECT)
    command_id = models.UUIDField()
    journal = models.OneToOneField('accounting.JournalEntry', on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'command_id'], name='unique_supplier_operation_command')]
