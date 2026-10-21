import uuid

from django.core.files.storage import default_storage
from rest_framework import serializers

from .models import Category, Product, ProductVariant, ProductUnit, StockBatch


class ProductVariantSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    selections = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = ('id', 'label', 'sku', 'barcode', 'base_unit', 'purchase_price', 'retail_price',
                  'wholesale_price', 'minimum_stock', 'tracking_mode', 'is_active', 'selections',
                  'created_at', 'updated_at')
        read_only_fields = ('selections', 'created_at', 'updated_at')
        extra_kwargs = {'sku': {'required': False, 'allow_blank': True}}

    def get_selections(self, obj):
        return {row.attribute.name: row.value.value for row in obj.selections.select_related('attribute', 'value')}

    def validate(self, attrs):
        if self.instance and 'id' in attrs:
            raise serializers.ValidationError({'id': 'Variant ID cannot be changed.'})
        if self.instance and attrs.get('sku') == '':
            attrs['sku'] = 'V-' + self.instance.id.hex[:12].upper()
        if self.instance and attrs.get('barcode') == '':
            attrs['barcode'] = 'B-' + self.instance.id.hex[:16].upper()
        for field in ('purchase_price', 'retail_price', 'wholesale_price', 'minimum_stock'):
            if attrs.get(field) is not None and attrs[field] < 0:
                raise serializers.ValidationError({field: 'Cannot be negative.'})
        return attrs


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ('id', 'name', 'parent', 'is_active', 'updated_at')
        read_only_fields = ('id', 'updated_at')

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Enter a category name.')
        return value

    def validate_parent(self, value):
        if value and (value.business_id != self.context['business_id'] or not value.is_active):
            raise serializers.ValidationError('Choose an active category in this business.')
        return value

    def validate(self, attrs):
        parent = attrs.get('parent', self.instance.parent if self.instance else None)
        if self.instance and parent:
            seen = {self.instance.pk}
            cursor = parent
            while cursor:
                if cursor.pk in seen:
                    raise serializers.ValidationError({'parent': 'Category nesting cannot contain a cycle.'})
                seen.add(cursor.pk)
                cursor = cursor.parent
        return attrs


class ProductSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    image_url = serializers.SerializerMethodField()
    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all(), allow_null=True, required=False)

    class Meta:
        model = Product
        fields = ('id', 'name', 'product_type', 'specifications', 'description', 'sku', 'barcode', 'category', 'base_unit',
                  'purchase_price', 'retail_price', 'wholesale_price', 'image_url',
                  'minimum_stock', 'tracking_mode', 'is_active', 'created_at', 'updated_at')
        read_only_fields = ('image_url', 'created_at', 'updated_at')
        extra_kwargs = {'sku': {'required': False, 'allow_blank': True}, 'barcode': {'required': False, 'allow_blank': True}}

    def get_image_url(self, obj):
        if not obj.image_key:
            return None
        return default_storage.url(obj.image_key)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Enter a product name.')
        return value

    def validate_sku(self, value):
        return value.strip()

    def validate_barcode(self, value):
        return value.strip()

    def validate_category(self, value):
        if value and (value.business_id != self.context['business_id'] or not value.is_active):
            raise serializers.ValidationError('Choose an active category in this business.')
        return value

    def validate(self, attrs):
        if self.instance and 'id' in attrs:
            raise serializers.ValidationError({'id': 'Product ID cannot be changed.'})
        if self.instance and attrs.get('sku') == '':
            attrs['sku'] = 'P-' + self.instance.id.hex[:12].upper()
        if self.instance and attrs.get('barcode') == '':
            attrs['barcode'] = 'B-' + self.instance.id.hex[:16].upper()
        if self.instance and self.instance.product_type == 'variant':
            restricted = set(attrs) - {'name', 'description', 'category', 'specifications', 'is_active'}
            if restricted:
                raise serializers.ValidationError({field: 'Edit this on the variant.' for field in restricted})
        if self.instance and 'product_type' in attrs and attrs['product_type'] != self.instance.product_type:
            from stockkeeper.models import StockMovement, StockBalance
            if StockMovement.objects.filter(product=self.instance).exists() or StockBalance.objects.filter(product=self.instance, quantity__gt=0).exists():
                raise serializers.ValidationError({'product_type': 'A product with stock or history cannot be converted.'})
            raise serializers.ValidationError({'product_type': 'Create a new product to change its variant structure.'})
        for key in ('purchase_price', 'retail_price', 'wholesale_price', 'minimum_stock'):
            if attrs.get(key) is not None and attrs[key] < 0:
                raise serializers.ValidationError({key: 'Cannot be negative.'})
        if self.instance and 'tracking_mode' in attrs and attrs['tracking_mode'] != self.instance.tracking_mode:
            # Stock conversion is a separate, audited command in milestone C.
            from stockkeeper.models import StockMovement
            if StockMovement.objects.filter(product=self.instance).exists():
                raise serializers.ValidationError({'tracking_mode': 'Use the stock conversion workflow for a product with stock history.'})
        return attrs

    def create(self, validated_data):
        validated_data['business_id'] = self.context['business_id']
        validated_data.setdefault('id', uuid.uuid4())
        if not validated_data.get('sku'):
            validated_data['sku'] = 'P-' + validated_data['id'].hex[:12].upper()
        if not validated_data.get('barcode'):
            validated_data['barcode'] = 'B-' + validated_data['id'].hex[:16].upper()
        return super().create(validated_data)


class ProductListSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    sellable_stock = serializers.SerializerMethodField()
    low_stock = serializers.SerializerMethodField()
    out_of_stock = serializers.SerializerMethodField()
    variant_count = serializers.SerializerMethodField()
    stock_by_unit = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = ('id', 'name', 'product_type', 'variant_count', 'sku', 'barcode', 'category', 'retail_price', 'image_url', 'sellable_stock', 'stock_by_unit', 'low_stock', 'out_of_stock', 'is_active', 'updated_at')

    def get_variant_count(self, obj):
        return sum(1 for variant in obj.variants.all() if variant.is_active and not variant.is_default)

    def get_image_url(self, obj):
        return default_storage.url(obj.image_key) if obj.image_key else None

    def get_sellable_stock(self, obj):
        if obj.product_type == 'variant' and len({variant.base_unit for variant in obj.variants.all() if variant.is_active}) > 1:
            return None
        return str(obj.sellable_sum or 0)

    def get_stock_by_unit(self, obj):
        if obj.product_type == 'simple':
            return None
        from stockkeeper.services import business_today
        today = business_today(obj.business)
        grouped = {}
        for row in obj.balances.all():
            if row.variant.is_active and (not row.batch or not row.batch.expires_on or row.batch.expires_on >= today):
                unit = row.variant.base_unit
                grouped[unit] = grouped.get(unit, 0) + row.quantity
        return [{'unit': unit, 'quantity': str(amount)} for unit, amount in sorted(grouped.items())]

    def get_low_stock(self, obj):
        return bool(obj.minimum_stock and obj.sellable_sum > 0 and obj.sellable_sum <= obj.minimum_stock)

    def get_out_of_stock(self, obj):
        return obj.sellable_sum <= 0


class ProductUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductUnit
        fields = ('id', 'name', 'factor', 'selling_price', 'barcode', 'is_active')
        read_only_fields = ('id',)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Enter a package name.')
        return value

    def validate(self, attrs):
        if attrs.get('factor', self.instance.factor if self.instance else 0) <= 0:
            raise serializers.ValidationError({'factor': 'Conversion must be positive.'})
        if attrs.get('selling_price') is not None and attrs['selling_price'] < 0:
            raise serializers.ValidationError({'selling_price': 'Cannot be negative.'})
        if self.instance and 'factor' in attrs and attrs['factor'] != self.instance.factor:
            from stockkeeper.models import StockMovement
            if StockMovement.objects.filter(variant=self.instance.variant).exists():
                raise serializers.ValidationError({'factor': 'Historical transactions use this conversion. Create a new package instead.'})
        return attrs


class StockBatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockBatch
        fields = ('id', 'lot_code', 'manufactured_on', 'expires_on', 'created_at')
        read_only_fields = ('id', 'created_at')

    def validate_lot_code(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Enter a batch identifier.')
        return value
