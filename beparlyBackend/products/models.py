import uuid

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.db.models.functions import Lower


class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT, related_name='product_categories')
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='children')
    name = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower('name'), 'business', 'parent', name='unique_category_sibling_name'),
            models.UniqueConstraint(Lower('name'), 'business', condition=Q(parent__isnull=True), name='unique_category_root_name'),
        ]
        indexes = [models.Index(fields=['business', 'parent'])]

    def clean(self):
        if self.parent_id:
            if self.parent.business_id != self.business_id:
                raise ValidationError({'parent': 'Parent category belongs to another business.'})
            seen = {self.pk}
            ancestor = self.parent
            while ancestor:
                if ancestor.pk in seen:
                    raise ValidationError({'parent': 'Category nesting cannot contain a cycle.'})
                seen.add(ancestor.pk)
                ancestor = ancestor.parent


class Product(models.Model):
    PRODUCT_TYPES = [('simple', 'Simple'), ('variant', 'Variants')]
    SIMPLE = 'simple'
    BATCH = 'batch'
    EXPIRY = 'expiry'
    TRACKING_CHOICES = [(SIMPLE, 'Simple stock'), (BATCH, 'Batch tracking'), (EXPIRY, 'Batch and expiry')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT, related_name='products')
    name = models.CharField(max_length=180)
    product_type = models.CharField(max_length=8, choices=PRODUCT_TYPES, default='simple')
    specifications = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True)
    sku = models.CharField(max_length=64)
    barcode = models.CharField(max_length=100, blank=True)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT, related_name='products')
    base_unit = models.CharField(max_length=40, default='Piece')
    purchase_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    retail_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    wholesale_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    image_key = models.CharField(max_length=500, blank=True)
    minimum_stock = models.DecimalField(max_digits=18, decimal_places=3, default=0)
    tracking_mode = models.CharField(max_length=8, choices=TRACKING_CHOICES, default=SIMPLE)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['business', 'sku'], name='unique_product_sku_per_business'),
            models.UniqueConstraint(fields=['business', 'barcode'], condition=~Q(barcode=''), name='unique_product_barcode_per_business'),
            models.CheckConstraint(condition=Q(minimum_stock__gte=0), name='product_minimum_stock_nonnegative'),
        ]
        indexes = [models.Index(fields=['business', 'is_active', 'name'])]

    def clean(self):
        if self.category_id and self.category.business_id != self.business_id:
            raise ValidationError({'category': 'Category belongs to another business.'})

    def save(self, *args, **kwargs):
        creating = self._state.adding
        with transaction.atomic():
            super().save(*args, **kwargs)
            if creating and self.product_type == 'simple':
                ProductVariant.objects.create(
                    product=self, business_id=self.business_id, is_default=True,
                    sku=self.sku, barcode=self.barcode, base_unit=self.base_unit,
                    purchase_price=self.purchase_price, retail_price=self.retail_price,
                    wholesale_price=self.wholesale_price, minimum_stock=self.minimum_stock,
                    tracking_mode=self.tracking_mode, is_active=self.is_active,
                )


class ProductAttribute(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='attributes')
    name = models.CharField(max_length=80)

    class Meta:
        constraints = [models.UniqueConstraint(Lower('name'), 'product', name='unique_attribute_name_per_product')]


class ProductAttributeValue(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    attribute = models.ForeignKey(ProductAttribute, on_delete=models.PROTECT, related_name='values')
    value = models.CharField(max_length=100)

    class Meta:
        constraints = [models.UniqueConstraint(Lower('value'), 'attribute', name='unique_value_per_attribute')]


class ProductVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='variants')
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    label = models.CharField(max_length=180, blank=True)
    is_default = models.BooleanField(default=False)
    # A sorted list of attribute/value UUID pairs. Empty for the hidden simple variant.
    combination_key = models.CharField(max_length=1500, blank=True)
    sku = models.CharField(max_length=64)
    barcode = models.CharField(max_length=100, blank=True)
    base_unit = models.CharField(max_length=40, default='Piece')
    purchase_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    retail_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    wholesale_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    minimum_stock = models.DecimalField(max_digits=18, decimal_places=3, default=0)
    tracking_mode = models.CharField(max_length=8, choices=Product.TRACKING_CHOICES, default=Product.SIMPLE)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['product'], condition=Q(is_default=True), name='one_default_variant_per_product'),
            models.UniqueConstraint(fields=['product', 'combination_key'], condition=Q(is_active=True, is_default=False), name='unique_active_variant_combination'),
            models.UniqueConstraint(fields=['business', 'sku'], name='unique_variant_sku_per_business'),
            models.UniqueConstraint(fields=['business', 'barcode'], condition=~Q(barcode=''), name='unique_variant_barcode_per_business'),
            models.CheckConstraint(condition=Q(minimum_stock__gte=0), name='variant_minimum_stock_nonnegative'),
        ]

    def clean(self):
        if self.product_id and self.product.business_id != self.business_id:
            raise ValidationError({'product': 'Variant belongs to another business.'})
        if self.is_default != (self.product.product_type == 'simple'):
            raise ValidationError({'is_default': 'Default variants belong to simple products only.'})

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)


class VariantSelection(models.Model):
    variant = models.ForeignKey(ProductVariant, on_delete=models.PROTECT, related_name='selections')
    attribute = models.ForeignKey(ProductAttribute, on_delete=models.PROTECT)
    value = models.ForeignKey(ProductAttributeValue, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['variant', 'attribute'], name='one_value_per_variant_attribute')]

    def clean(self):
        if self.attribute.product_id != self.variant.product_id or self.value.attribute_id != self.attribute_id:
            raise ValidationError('Variant selection must use an allowed value of this product.')


class CatalogCommand(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    command_id = models.UUIDField()
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'command_id'], name='unique_catalog_command')]


class ProductUnit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='packages')
    variant = models.ForeignKey(ProductVariant, on_delete=models.PROTECT, related_name='packages')
    name = models.CharField(max_length=40)
    factor = models.DecimalField(max_digits=18, decimal_places=3)
    selling_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    barcode = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower('name'), 'variant', name='unique_package_name_per_variant'),
            models.CheckConstraint(condition=Q(factor__gt=0), name='package_factor_positive'),
        ]

    def save(self, *args, **kwargs):
        if self.variant.product_id != self.product_id:
            raise ValidationError('Packaging unit and variant must belong to the same product.')
        super().save(*args, **kwargs)


class StockBatch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='batches')
    variant = models.ForeignKey(ProductVariant, on_delete=models.PROTECT, related_name='batches')
    lot_code = models.CharField(max_length=100)
    manufactured_on = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['variant', 'lot_code', 'expires_on'], name='unique_variant_lot_expiry'),
            models.UniqueConstraint(fields=['variant', 'lot_code'], condition=Q(expires_on__isnull=True), name='unique_variant_lot_no_expiry'),
        ]
        indexes = [models.Index(fields=['product', 'expires_on'])]

    def save(self, *args, **kwargs):
        if self.variant.product_id != self.product_id:
            raise ValidationError('Batch and variant must belong to the same product.')
        super().save(*args, **kwargs)
