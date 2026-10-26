"""Validation and atomic construction of explicit product variants."""

import uuid

from rest_framework import serializers

from .models import ProductAttribute, ProductAttributeValue, ProductVariant, VariantSelection
from .serializers import ProductVariantSerializer
from .barcodes import generated_barcode


def make_attributes(product, definitions):
    if not isinstance(definitions, list) or not definitions or len(definitions) > 8:
        raise serializers.ValidationError({'attributes': 'Define between one and eight attributes.'})
    result = {}
    for item in definitions:
        if not isinstance(item, dict) or not isinstance(item.get('name'), str):
            raise serializers.ValidationError({'attributes': 'Each attribute needs a name and allowed values.'})
        name = item['name'].strip()
        values = item.get('values')
        if not name or len(name) > 80 or name.casefold() in result or not isinstance(values, list) or not values or len(values) > 100:
            raise serializers.ValidationError({'attributes': 'Attribute names and values must be unique and nonempty.'})
        attribute = ProductAttribute.objects.create(product=product, name=name)
        choices = {}
        for raw in values:
            if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > 100 or raw.strip().casefold() in choices:
                raise serializers.ValidationError({'attributes': 'Allowed values must be unique and nonempty.'})
            value = ProductAttributeValue.objects.create(attribute=attribute, value=raw.strip())
            choices[raw.strip().casefold()] = value
        result[name.casefold()] = (attribute, choices)
    return result


def make_variant(product, data, attributes):
    if not isinstance(data, dict) or not isinstance(data.get('selections'), dict):
        raise serializers.ValidationError({'variants': 'Select one allowed value for every attribute.'})
    raw = data['selections']
    if len(raw) != len(attributes) or len({name.casefold() for name in raw}) != len(attributes):
        raise serializers.ValidationError({'selections': 'Select exactly one value for every attribute.'})
    selected = []
    for name, value in raw.items():
        entry = attributes.get(name.casefold()) if isinstance(name, str) else None
        choice = entry[1].get(value.casefold()) if entry and isinstance(value, str) else None
        if not choice:
            raise serializers.ValidationError({'selections': 'Choose an allowed value for every attribute.'})
        selected.append((entry[0], choice))
    selected.sort(key=lambda pair: str(pair[0].pk))
    key = '|'.join(f'{attribute.pk}:{value.pk}' for attribute, value in selected)
    serializer = ProductVariantSerializer(data={key: value for key, value in data.items() if key != 'selections'})
    serializer.is_valid(raise_exception=True)
    fields = serializer.validated_data
    if not fields.get('base_unit'):
        raise serializers.ValidationError({'variants': 'Each variant needs a base unit.'})
    fields.setdefault('id', uuid.uuid4())
    if not fields.get('sku'):
        fields['sku'] = 'V-' + fields['id'].hex[:12].upper()
    if not fields.get('barcode'):
        fields['barcode'] = generated_barcode(fields['id'])
    variant = ProductVariant.objects.create(
        product=product, business_id=product.business_id, combination_key=key,
        label=fields.get('label') or ' / '.join(value.value for _, value in selected),
        **{name: value for name, value in fields.items() if name != 'label'},
    )
    VariantSelection.objects.bulk_create([
        VariantSelection(variant=variant, attribute=attribute, value=value)
        for attribute, value in selected
    ])
    return variant
