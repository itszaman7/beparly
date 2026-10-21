from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
import uuid


class StockLocation(models.Model):
    SHOP = 'shop'
    WAREHOUSE = 'warehouse'
    TYPE_CHOICES = [(SHOP, 'Shop'), (WAREHOUSE, 'Warehouse')]

    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT, related_name='stock_locations')
    name = models.CharField(max_length=160)
    type = models.CharField(max_length=12, choices=TYPE_CHOICES, default=SHOP)
    address = models.CharField(max_length=255, blank=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'name', 'id']
        constraints = [
            models.UniqueConstraint(fields=['business'], condition=Q(is_default=True), name='one_default_stock_location'),
            models.UniqueConstraint(Lower('name'), 'business', name='unique_stock_location_name_per_business'),
        ]

    def clean(self):
        if self.is_default and not self.is_active:
            raise ValidationError({'is_active': 'The default location must stay active.'})

    def __str__(self):
        return f'{self.name} ({self.business})'


class StockBalance(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    product = models.ForeignKey('products.Product', on_delete=models.PROTECT, related_name='balances')
    variant = models.ForeignKey('products.ProductVariant', on_delete=models.PROTECT, related_name='balances')
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT, related_name='balances')
    batch = models.ForeignKey('products.StockBatch', null=True, blank=True, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=18, decimal_places=3, default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['variant', 'location'], condition=Q(batch__isnull=True), name='unique_simple_variant_balance'),
            models.UniqueConstraint(fields=['variant', 'location', 'batch'], condition=Q(batch__isnull=False), name='unique_batch_variant_balance'),
            models.CheckConstraint(condition=Q(quantity__gte=0), name='stock_balance_nonnegative'),
        ]

    def save(self, *args, **kwargs):
        validate_stock_links(self)
        super().save(*args, **kwargs)


class CostLayer(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    product = models.ForeignKey('products.Product', on_delete=models.PROTECT)
    variant = models.ForeignKey('products.ProductVariant', on_delete=models.PROTECT)
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT)
    batch = models.ForeignKey('products.StockBatch', null=True, blank=True, on_delete=models.PROTECT)
    received_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    remaining_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=4)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(remaining_quantity__gte=0), name='cost_layer_remaining_nonnegative')]
        indexes = [models.Index(fields=['business', 'product', 'location', 'created_at'])]

    def save(self, *args, **kwargs):
        validate_stock_links(self)
        super().save(*args, **kwargs)


class StockMovement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    product = models.ForeignKey('products.Product', on_delete=models.PROTECT)
    variant = models.ForeignKey('products.ProductVariant', on_delete=models.PROTECT)
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT)
    batch = models.ForeignKey('products.StockBatch', null=True, blank=True, on_delete=models.PROTECT)
    type = models.CharField(max_length=24)
    quantity_change = models.DecimalField(max_digits=18, decimal_places=3)
    inventory_cost = models.DecimalField(max_digits=22, decimal_places=7)
    unit_name = models.CharField(max_length=40, default='')
    conversion_factor = models.DecimalField(max_digits=18, decimal_places=3, default=1)
    reason = models.CharField(max_length=240, blank=True)
    reference_id = models.UUIDField()
    opening_movement = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='corrections')
    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['business', 'product', 'created_at']), models.Index(fields=['business', 'location', 'created_at'])]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError('Posted stock movements are append-only.')
        validate_stock_links(self)
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Posted stock movements cannot be deleted.')


class StockCommand(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    command_id = models.UUIDField()
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'command_id'], name='unique_stock_command')]


def validate_stock_links(row):
    if row.variant.product_id != row.product_id or row.variant.business_id != row.business_id:
        raise ValidationError('Stock variant, product and business must agree.')
    if row.location.business_id != row.business_id:
        raise ValidationError('Stock location belongs to another business.')
    if row.batch_id and (row.batch.variant_id != row.variant_id or row.batch.product_id != row.product_id):
        raise ValidationError('Stock batch belongs to another variant.')
