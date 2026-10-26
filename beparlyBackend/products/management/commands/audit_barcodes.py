"""Read-only check of the sellable barcode namespace before a pilot import."""
import json
from collections import defaultdict

from django.core.management.base import BaseCommand

from products.barcodes import normalize_barcode
from products.models import Product, ProductUnit, ProductVariant


class Command(BaseCommand):
    help = 'Report ambiguous or whitespace-padded product/variant/package barcodes without changing catalog data.'

    def add_arguments(self, parser):
        parser.add_argument('--business-id', type=int)

    def handle(self, *args, **options):
        business_id = options['business_id']
        groups = defaultdict(list)
        padded = []
        blank_count = defaultdict(int)

        def add(kind, record_id, owner_id, scope, raw):
            code = normalize_barcode(raw)
            if not code:
                blank_count[kind] += 1
                return
            if raw != raw.strip():
                padded.append({'business_id': scope, 'kind': kind, 'id': str(record_id)})
            groups[(scope, code)].append({'kind': kind, 'id': str(record_id), 'product_id': str(owner_id)})

        products = Product.objects.all()
        variants = ProductVariant.objects.select_related('product').all()
        units = ProductUnit.objects.select_related('variant').all()
        if business_id is not None:
            products = products.filter(business_id=business_id)
            variants = variants.filter(business_id=business_id)
            units = units.filter(variant__business_id=business_id)
        mirrored = set()
        for variant in variants.iterator():
            add('variant', variant.pk, variant.product_id, variant.business_id, variant.barcode)
            if variant.is_default and normalize_barcode(variant.barcode) == normalize_barcode(variant.product.barcode):
                mirrored.add(variant.product_id)
        for product in products.iterator():
            if product.pk not in mirrored:
                add('product', product.pk, product.pk, product.business_id, product.barcode)
        for unit in units.iterator():
            add('package', unit.pk, unit.variant.product_id, unit.variant.business_id, unit.barcode)

        conflicts = [{'business_id': scope, 'code': code, 'targets': targets}
                     for (scope, code), targets in groups.items() if len(targets) > 1]
        self.stdout.write(json.dumps({'conflict_count': len(conflicts), 'conflicts': conflicts,
                                      'padded_count': len(padded), 'padded': padded,
                                      'blank_count': dict(blank_count)}, sort_keys=True))
