import io
import json
import uuid
import tempfile
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.db import DatabaseError, connection, transaction
from unittest import skipUnless
from PIL import Image

from accounts.models import Business, BusinessMember, User
from audit.models import AuditEvent

from .models import Category, Product, ProductVariant, ProductUnit, StockBatch
from .barcodes import generated_barcode
from stockkeeper.models import StockBalance, StockMovement, StockLocation
from purchases.services import save_draft, complete_purchase
from accounting.models import Contact


class ProductApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone='01711111111', password='ExamplePass#83')
        self.other = User.objects.create_user(phone='01811111111', password='ExamplePass#83')
        self.business = Business.objects.create(name='One')
        self.other_business = Business.objects.create(name='Two')
        BusinessMember.objects.create(user=self.user, business=self.business, role=BusinessMember.OWNER)
        BusinessMember.objects.create(user=self.other, business=self.other_business, role=BusinessMember.OWNER)
        self.token = self.login('01711111111')
        self.other_token = self.login('01811111111')
        self.base = f'/api/v1/businesses/{self.business.pk}/'

    def login(self, phone):
        response = self.client.post('/api/v1/auth/login/',
                                    json.dumps({'phone': phone, 'password': 'ExamplePass#83'}),
                                    content_type='application/json')
        return response.json()['token']

    def call(self, method, path, data=None, token=None, command=None):
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token or self.token}'}
        if command:
            headers['HTTP_X_COMMAND_ID'] = str(command)
        if data is None:
            return getattr(self.client, method)(path, **headers)
        return getattr(self.client, method)(path, json.dumps(data), content_type='application/json', **headers)

    def test_blank_product_and_package_codes_are_generated_and_scannable(self):
        created = self.call('post', self.base + 'products/', {'name': 'Biscuits'}, command=uuid.uuid4())
        self.assertEqual(created.status_code, 201, created.content)
        product = created.json()['product']
        self.assertTrue(product['barcode'].startswith('B-'))
        self.assertLessEqual(len(product['barcode']), 16)
        self.assertEqual(self.call('get', self.base + f"products/{product['id']}/barcode-labels/?paper=50x30").status_code, 200)
        package = self.call('post', self.base + f"products/{product['id']}/units/",
            {'name': 'Carton', 'factor': '12'})
        self.assertEqual(package.status_code, 201, package.content)
        unit = package.json()['unit']
        self.assertTrue(unit['barcode'].startswith('B-'))
        self.assertNotEqual(unit['barcode'], product['barcode'])
        lookup = self.call('get', self.base + f"products/barcodes/lookup/?code={unit['barcode']}")
        self.assertEqual(lookup.status_code, 200, lookup.content)
        self.assertEqual(lookup.json()['target']['unit_id'], unit['id'])

    def test_legacy_blank_barcode_can_be_assigned_then_printed_once(self):
        product = Product.objects.create(business=self.business, name='Old biscuits', sku='OLD-1', barcode='')
        path = self.base + f'products/{product.pk}/barcode-labels/'
        self.assertEqual(self.call('get', path).status_code, 400)
        first = self.call('post', path, {})
        self.assertEqual(first.status_code, 200, first.content)
        code = first.json()['barcode']
        self.assertTrue(code.startswith('B-'))
        self.assertEqual(self.call('post', path, {}).json()['barcode'], code)
        product.refresh_from_db()
        self.assertEqual(product.barcode, code)
        self.assertEqual(product.variants.get(is_default=True).barcode, code)
        self.assertEqual(AuditEvent.objects.filter(product_id=product.pk, entity_type='product', action='updated').count(), 1)
        pdf = self.call('get', path)
        self.assertEqual(pdf.status_code, 200, pdf.content[:300])
        self.assertTrue(pdf.content.startswith(b'%PDF-'))
        self.assertEqual(self.call('get', self.base + f'products/barcodes/lookup/?code={code}').status_code, 200)
        self.assertEqual(self.call('post', path, {}, token=self.other_token).status_code, 404)

    def test_legacy_variant_and_package_codes_are_scoped_and_idempotent(self):
        product = Product.objects.create(business=self.business, name='Old phone', product_type='variant', sku='PHONE')
        variant = ProductVariant.objects.create(business=self.business, product=product, sku='PHONE-BLUE', barcode='',
                                                 label='Blue', combination_key='blue')
        unit = ProductUnit.objects.create(product=product, variant=variant, name='Case', factor=12, barcode='')
        path = self.base + f'products/{product.pk}/barcode-labels/'
        variant_path = path + f'?variant_id={variant.pk}'
        self.assertEqual(self.call('post', path, {}).status_code, 400)
        variant_code = self.call('post', path, {'variant_id': str(variant.pk)}).json()['barcode']
        self.assertEqual(self.call('post', path, {'variant_id': str(variant.pk)}).json()['barcode'], variant_code)
        unit_code = self.call('post', path, {'variant_id': str(variant.pk), 'unit_id': str(unit.pk)}).json()['barcode']
        self.assertNotEqual(variant_code, unit_code)
        self.assertEqual(self.call('get', variant_path + f'&unit_id={unit.pk}').status_code, 200)
        self.assertEqual(AuditEvent.objects.filter(product_id=product.pk, action='updated').count(), 2)

    def test_exact_barcode_lookup_preserves_package_identity_and_rejects_collisions(self):
        product = Product.objects.create(business=self.business, name='Rice', sku='RICE-1',
            barcode='RICE-BASE', retail_price=Decimal('20.00'))
        unit_path = self.base + f'products/{product.pk}/units/'
        created = self.call('post', unit_path, {'name': 'Carton', 'factor': '12',
            'selling_price': '220.00', 'barcode': 'RICE-CASE'})
        self.assertEqual(created.status_code, 201, created.content)
        unit_id = created.json()['unit']['id']
        lookup = self.base + 'products/barcodes/lookup/?code='
        target = self.call('get', lookup + 'RICE-CASE').json()['target']
        self.assertEqual(target['unit_id'], unit_id)
        self.assertEqual(target['factor'], '12.000')
        self.assertEqual(target['retail_price'], '220.00')
        self.assertEqual(self.call('get', lookup + 'RICE-BASE').json()['target']['unit_id'], None)
        self.assertEqual(self.call('get', lookup + 'RICE-CASE', token=self.other_token).status_code, 404)
        duplicate = self.call('post', unit_path, {'name': 'Bag', 'factor': '5', 'barcode': 'rice-base'})
        self.assertEqual(duplicate.status_code, 409)
        self.assertFalse(ProductUnit.objects.filter(product=product, name='Bag').exists())
        conflicting_product = self.call('post', self.base + 'products/',
            {'name': 'Other rice', 'sku': 'RICE-2', 'barcode': 'rice-case'}, command=uuid.uuid4())
        self.assertEqual(conflicting_product.status_code, 409)
        self.assertFalse(Product.objects.filter(business=self.business, sku='RICE-2').exists())
        labels = self.call('get', self.base + f'products/{product.pk}/barcode-labels/?unit_id={unit_id}&paper=50x30&count=2')
        self.assertEqual(labels.status_code, 200, labels.content[:300])
        self.assertTrue(labels.content.startswith(b'%PDF-'))
        self.assertEqual(labels.content.count(b'/Type /Page\n'), 2)
        self.assertEqual(self.call('get', self.base + f'products/{product.pk}/barcode-labels/?paper=bad').status_code, 400)
        self.assertEqual(self.call('get', self.base + f'products/{product.pk}/barcode-labels/', token=self.other_token).status_code, 404)

    def test_purchase_catalog_returns_exact_variants_and_last_received_base_cost(self):
        product = Product.objects.create(business=self.business, name='Vivo X300', product_type='variant', sku='VIVO')
        small = ProductVariant.objects.create(business=self.business, product=product, sku='VX-8', barcode='80123',
                                              label='8GB / 256GB', combination_key='8-256', base_unit='Piece', purchase_price=Decimal('65000'))
        ProductVariant.objects.create(business=self.business, product=product, sku='VX-12', barcode='120123',
                                      label='12GB / 256GB', combination_key='12-256', base_unit='Piece', purchase_price=Decimal('72000'))
        supplier = Contact.objects.create(business=self.business, name='Distributor', is_supplier=True, created_by=self.user)
        location = StockLocation.objects.get(business=self.business, is_default=True)
        purchase = save_draft(self.business, self.user, uuid.uuid4(), {'supplier_id': str(supplier.pk),
            'location_id': location.pk, 'lines': [{'product_id': str(product.pk), 'variant_id': str(small.pk),
                                                  'quantity': '2', 'unit_cost': '60000'}]})
        complete_purchase(purchase, self.user, uuid.uuid4(), due_date=date.today() + timedelta(days=30))
        response = self.call('get', self.base + 'products/purchase-catalog/?search=VX-8')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()['items']), 1)
        self.assertEqual(response.json()['items'][0]['variant_id'], str(small.pk))
        self.assertEqual(Decimal(response.json()['items'][0]['last_purchase_cost']), Decimal('60000'))
        carton = ProductUnit.objects.create(product=product, variant=small, name='Carton', factor=Decimal('2'), barcode='PACK-8')
        packed = save_draft(self.business, self.user, uuid.uuid4(), {'supplier_id': str(supplier.pk),
            'location_id': location.pk, 'lines': [{'product_id': str(product.pk), 'variant_id': str(small.pk),
                                                  'unit_id': str(carton.pk), 'quantity': '1', 'unit_cost': '100000'}]})
        complete_purchase(packed, self.user, uuid.uuid4(), due_date=date.today() + timedelta(days=30))
        packed_cost = self.call('get', self.base + 'products/purchase-catalog/?search=VX-8').json()['items'][0]
        self.assertEqual(Decimal(packed_cost['last_purchase_cost']), Decimal('50000'))
        self.assertTrue(self.call('get', self.base + 'products/purchase-catalog/?search=PACK-8').json()['items'][0]['package_barcode_match'])
        self.assertEqual(self.call('get', self.base + 'products/purchase-catalog/?search=80123').json()['items'][0]['sku'], 'VX-8')
        for index in range(30):
            ProductVariant.objects.create(business=self.business, product=product, sku=f'VX-{index + 20}',
                label=f'{index + 20}GB', combination_key=f'variant-{index}')
        first_page = self.call('get', self.base + 'products/purchase-catalog/')
        self.assertEqual(len(first_page.json()['items']), 30)
        self.assertEqual(first_page.json()['next_page'], 2)
        self.assertEqual(len(self.call('get', self.base + 'products/purchase-catalog/?page=2').json()['items']), 2)
        self.assertEqual(self.call('get', self.base + 'products/purchase-catalog/', token=self.other_token).status_code, 404)

    def test_nested_categories_and_descendant_filter(self):
        root = self.call('post', self.base + 'categories/', {'name': 'Computer'})
        self.assertEqual(root.status_code, 201, root.content)
        parent = root.json()['category']['id']
        for name in ('Apple', 'Mac', 'MacBook'):
            result = self.call('post', self.base + 'categories/', {'name': name, 'parent': parent})
            self.assertEqual(result.status_code, 201, result.content)
            parent = result.json()['category']['id']
        product = self.call('post', self.base + 'products/', {'name': 'Air', 'category': parent}, command=uuid.uuid4())
        self.assertEqual(product.status_code, 201, product.content)
        listed = self.call('get', self.base + f'products/?category={root.json()["category"]["id"]}')
        self.assertEqual(len(listed.json()['products']), 1)
        cycle = self.call('patch', self.base + f'categories/{root.json()["category"]["id"]}/', {'parent': parent})
        self.assertEqual(cycle.status_code, 400)
        duplicate = self.call('post', self.base + 'categories/', {'name': 'computer'})
        self.assertEqual(duplicate.status_code, 409)

    def test_product_activity_is_scoped_to_business(self):
        created = self.call('post', self.base + 'products/', {
            'name': 'Rice', 'opening_stock': {'quantity': '4', 'unit_cost': '20'},
        }, command=uuid.uuid4())
        self.assertEqual(created.status_code, 201, created.content)
        path = self.base + f'products/{created.json()["product"]["id"]}/movements/'
        activity = self.call('get', path)
        self.assertEqual(activity.status_code, 200)
        self.assertEqual(len(activity.json()['movements']), 1)
        self.assertEqual(activity.json()['movements'][0]['quantity_change'], '4.000')
        self.assertEqual(self.call('get', path, token=self.other_token).status_code, 404)

    def test_catalog_money_search_isolation_and_idempotency(self):
        command = uuid.uuid4()
        data = {'name': '  Rice  ', 'purchase_price': '29.15', 'retail_price': '30.20', 'barcode': '12345'}
        created = self.call('post', self.base + 'products/', data, command=command)
        self.assertEqual(created.status_code, 201, created.content)
        product = created.json()['product']
        self.assertEqual(product['name'], 'Rice')
        self.assertEqual(product['purchase_price'], '29.15')
        self.assertTrue(product['sku'].startswith('P-'))
        self.assertEqual(self.call('post', self.base + 'products/', data, command=command).json()['product']['id'], product['id'])
        self.assertEqual(Product.objects.filter(business=self.business).count(), 1)
        self.assertEqual(len(self.call('get', self.base + 'products/?search=12345').json()['products']), 1)
        self.assertEqual(self.call('post', self.base + 'products/', data, command=uuid.uuid4()).status_code, 409)
        self.assertEqual(self.call('post', self.base + 'products/', {'name': 'Bad', 'retail_price': '-1'}, command=uuid.uuid4()).status_code, 400)
        detail = self.base + f'products/{product["id"]}/'
        self.assertEqual(self.call('get', detail, token=self.other_token).status_code, 404)
        changed = self.call('patch', detail, {'is_active': False, 'retail_price': '0.00'})
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(Product.objects.get(pk=product['id']).retail_price, Decimal('0.00'))
        self.assertFalse(Product.objects.get(pk=product['id']).is_active)
        update_command = uuid.uuid4()
        update = self.call('patch', detail, {'name': 'New rice'}, command=update_command)
        self.assertEqual(update.status_code, 200, update.content)
        self.assertEqual(self.call('patch', detail, {'name': 'New rice'}, command=update_command).status_code, 200)
        self.assertEqual(AuditEvent.objects.filter(business=self.business, reference_id=update_command).count(), 1)

    def test_variant_creation_stock_isolation_and_ambiguous_command(self):
        product_id, red_id, blue_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        command = uuid.uuid4()
        body = {'id': product_id, 'name': 'Shirt', 'product_type': 'variant',
                'attributes': [{'name': 'Color', 'values': ['Red', 'Blue']}],
                'variants': [
                    {'id': red_id, 'sku': 'SHIRT-RED', 'base_unit': 'Piece', 'retail_price': '120',
                     'selections': {'Color': 'Red'}, 'opening_stock': {'quantity': '3', 'unit_cost': '80'}},
                    {'id': blue_id, 'sku': 'SHIRT-BLUE', 'base_unit': 'Piece', 'retail_price': '100',
                     'selections': {'Color': 'Blue'}, 'opening_stock': {'quantity': '5', 'unit_cost': '70'}},
                ]}
        created = self.call('post', self.base + 'products/', body, command=command)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()['product']['id'], product_id)
        self.assertEqual(self.call('post', self.base + 'products/', body, command=command).status_code, 200)
        self.assertEqual(Product.objects.get(pk=product_id).retail_price, Decimal('100'))
        self.assertEqual(ProductVariant.objects.filter(product_id=product_id).count(), 2)
        self.assertEqual(list(StockBalance.objects.filter(product_id=product_id).order_by('quantity').values_list('quantity', flat=True)),
                         [Decimal('3'), Decimal('5')])
        self.assertEqual(len(self.call('get', self.base + 'products/?search=SHIRT-BLUE').json()['products']), 1)
        receipt = {'product_id': product_id, 'location_id': StockLocation.objects.get(business=self.business, is_default=True).pk,
                   'quantity': '1', 'unit_cost': '80', 'reason': 'Count gain', 'financial_reason': 'count_gain'}
        self.assertEqual(self.call('post', self.base + 'stock/receipts/', receipt, command=uuid.uuid4()).status_code, 409)
        receipt['variant_id'] = red_id
        receipt_command = uuid.uuid4()
        response = self.call('post', self.base + 'stock/receipts/', receipt, command=receipt_command)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['variant_id'], red_id)
        self.assertEqual(self.call('post', self.base + 'stock/receipts/', receipt, command=receipt_command).json(), response.json())
        self.assertEqual(StockBalance.objects.get(variant_id=red_id).quantity, Decimal('4'))
        self.assertEqual(StockBalance.objects.get(variant_id=blue_id).quantity, Decimal('5'))
        second_location = self.call('post', self.base + 'locations/', {'name': 'Godown', 'type': 'warehouse'}).json()['location']['id']
        transfer = self.call('post', self.base + 'stock/transfers/', {'product_id': product_id,
            'variant_id': red_id, 'location_id': receipt['location_id'], 'destination_id': second_location,
            'quantity': '2'}, command=uuid.uuid4())
        self.assertEqual(transfer.status_code, 201, transfer.content)
        waste = self.call('post', self.base + 'stock/waste/', {'product_id': product_id,
            'variant_id': blue_id, 'location_id': receipt['location_id'], 'quantity': '1',
            'reason': 'damaged'}, command=uuid.uuid4())
        self.assertEqual(waste.status_code, 201, waste.content)
        self.assertEqual(StockBalance.objects.get(variant_id=red_id, location_id=second_location).quantity, Decimal('2'))
        self.assertEqual(StockBalance.objects.get(variant_id=blue_id).quantity, Decimal('4'))
        self.assertEqual(self.call('get', self.base + f'products/{product_id}/variants/{red_id}/', token=self.other_token).status_code, 404)
        unit_path = self.base + f'products/{product_id}/units/'
        unit = self.call('post', unit_path, {'variant_id': red_id, 'name': 'Box', 'factor': '10'})
        self.assertEqual(unit.status_code, 201, unit.content)
        other_unit = self.call('post', unit_path, {'variant_id': blue_id, 'name': 'Box', 'factor': '5'})
        self.assertEqual(other_unit.status_code, 201, other_unit.content)
        wrong_unit_receipt = {**receipt, 'variant_id': blue_id, 'unit_id': unit.json()['unit']['id']}
        self.assertEqual(self.call('post', self.base + 'stock/receipts/', wrong_unit_receipt,
                                   command=uuid.uuid4()).status_code, 409)
        duplicate = {**body, 'id': str(uuid.uuid4()), 'name': 'Duplicate',
                     'variants': [{**body['variants'][0], 'id': str(uuid.uuid4()), 'sku': 'SHIRT-DUP-A'},
                                  {**body['variants'][0], 'id': str(uuid.uuid4()), 'sku': 'SHIRT-DUP'}]}
        self.assertEqual(self.call('post', self.base + 'products/', duplicate, command=uuid.uuid4()).status_code, 409)

    def test_single_and_variant_auto_codes_keep_optional_fields(self):
        single_id, variant_product_id, variant_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        single = self.call('post', self.base + 'products/', {
            'id': str(single_id), 'name': 'Mug', 'barcode': '', 'sku': '',
            'wholesale_price': '95.00', 'specifications': {'Color': 'White'},
        }, command=uuid.uuid4())
        self.assertEqual(single.status_code, 201, single.content)
        item = single.json()['product']
        self.assertEqual(item['sku'], 'P-' + single_id.hex[:12].upper())
        self.assertEqual(item['barcode'], generated_barcode(single_id))
        self.assertEqual(item['wholesale_price'], '95.00')
        self.assertEqual(item['specifications'], {'Color': 'White'})
        self.assertEqual(ProductVariant.objects.get(product_id=single_id).barcode, item['barcode'])

        created = self.call('post', self.base + 'products/', {
            'id': str(variant_product_id), 'name': 'Shirt', 'product_type': 'variant',
            'attributes': [{'name': 'Color', 'values': ['Red']}],
            'variants': [{'id': str(variant_id), 'sku': '', 'barcode': '', 'base_unit': 'Piece',
                          'purchase_price': '80', 'retail_price': '120', 'wholesale_price': '100',
                          'tracking_mode': 'batch', 'selections': {'Color': 'Red'}}],
        }, command=uuid.uuid4())
        self.assertEqual(created.status_code, 201, created.content)
        variant = ProductVariant.objects.get(pk=variant_id)
        self.assertEqual(variant.sku, 'V-' + variant_id.hex[:12].upper())
        self.assertEqual(variant.barcode, generated_barcode(variant_id))
        self.assertEqual(variant.wholesale_price, Decimal('100'))
        self.assertEqual(variant.tracking_mode, 'batch')
        updated = self.call('patch', self.base + f'products/{variant_product_id}/variants/{variant_id}/',
                            {'sku': '', 'barcode': '', 'wholesale_price': '105.00'})
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(updated.json()['variant']['sku'], 'V-' + variant_id.hex[:12].upper())
        self.assertEqual(updated.json()['variant']['barcode'], generated_barcode(variant_id))
        self.assertEqual(updated.json()['variant']['wholesale_price'], '105.00')

    @skipUnless(connection.vendor == 'postgresql', 'Ownership triggers are PostgreSQL specific.')
    def test_database_rejects_cross_product_variant_reference(self):
        first = self.call('post', self.base + 'products/', {'name': 'First',
            'opening_stock': {'quantity': '1', 'unit_cost': '5'}}, command=uuid.uuid4()).json()['product']['id']
        second = self.call('post', self.base + 'products/', {'name': 'Second'}, command=uuid.uuid4()).json()['product']['id']
        other_variant = ProductVariant.objects.get(product_id=second)
        balance = StockBalance.objects.get(product_id=first)
        with self.assertRaises(DatabaseError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('UPDATE stockkeeper_stockbalance SET variant_id = %s WHERE id = %s',
                               [other_variant.pk, balance.pk])
        self.assertEqual(StockBalance.objects.get(pk=balance.pk).product_id, uuid.UUID(first))

    def test_variant_batches_and_expiry_are_scoped(self):
        red_id, blue_id = str(uuid.uuid4()), str(uuid.uuid4())
        created = self.call('post', self.base + 'products/', {'name': 'Medicine', 'product_type': 'variant',
            'attributes': [{'name': 'Strength', 'values': ['10mg', '20mg']}],
            'variants': [{'id': red_id, 'sku': 'MED-10', 'base_unit': 'Piece', 'tracking_mode': 'expiry',
                          'selections': {'Strength': '10mg'}},
                         {'id': blue_id, 'sku': 'MED-20', 'base_unit': 'Piece', 'tracking_mode': 'expiry',
                          'selections': {'Strength': '20mg'}}]}, command=uuid.uuid4())
        self.assertEqual(created.status_code, 201, created.content)
        product_id = created.json()['product']['id']
        path = self.base + f'products/{product_id}/batches/'
        self.assertEqual(self.call('post', path, {'variant_id': red_id, 'lot_code': 'LOT-1'}).status_code, 400)
        batch = self.call('post', path, {'variant_id': red_id, 'lot_code': 'LOT-1', 'expires_on': '2027-01-01'})
        self.assertEqual(batch.status_code, 201, batch.content)
        location = StockLocation.objects.get(business=self.business, is_default=True)
        wrong = self.call('post', self.base + 'stock/receipts/', {'product_id': product_id,
            'variant_id': blue_id, 'location_id': location.pk, 'batch_id': batch.json()['batch']['id'],
            'quantity': '1', 'unit_cost': '20', 'reason': 'Count gain', 'financial_reason': 'count_gain'}, command=uuid.uuid4())
        self.assertEqual(wrong.status_code, 409)
        correct = self.call('post', self.base + 'stock/receipts/', {'product_id': product_id,
            'variant_id': red_id, 'location_id': location.pk, 'batch_id': batch.json()['batch']['id'],
            'quantity': '1', 'unit_cost': '20', 'reason': 'Count gain', 'financial_reason': 'count_gain'}, command=uuid.uuid4())
        self.assertEqual(correct.status_code, 201, correct.content)
        self.assertEqual(StockBalance.objects.get(variant_id=red_id).quantity, Decimal('1'))
        self.assertFalse(StockBalance.objects.filter(variant_id=blue_id).exists())

    def test_catalog_filters_sort_and_summary_are_business_scoped(self):
        shop = StockLocation.objects.get(business=self.business, is_default=True)
        rice = Product.objects.create(business=self.business, name='Rice', sku='RICE',
                                      retail_price=Decimal('80'), minimum_stock=Decimal('5'))
        tea = Product.objects.create(business=self.business, name='Tea', sku='TEA',
                                     retail_price=Decimal('20'), minimum_stock=Decimal('2'), tracking_mode='batch')
        Product.objects.create(business=self.business, name='Oil', sku='OIL', retail_price=None)
        Product.objects.create(business=self.business, name='Hidden', sku='HIDDEN', is_active=False)
        Product.objects.create(business=self.other_business, name='Secret', sku='SECRET')
        StockBalance.objects.create(business=self.business, product=rice, variant=rice.variants.get(), location=shop, quantity=Decimal('10'))
        StockBalance.objects.create(business=self.business, product=tea, variant=tea.variants.get(), location=shop, quantity=Decimal('1'))
        base = self.base + 'products/'

        def names(query):
            response = self.call('get', base + '?' + query)
            self.assertEqual(response.status_code, 200, response.content)
            return [item['name'] for item in response.json()['products']]

        self.assertEqual(names('active=true&stock=low_stock'), ['Tea'])
        self.assertEqual(names('active=true&stock=out_of_stock'), ['Oil'])
        self.assertEqual(names('active=true&stock=in_stock&tracking=batch'), ['Tea'])
        self.assertEqual(names('active=false'), ['Hidden'])
        self.assertEqual(names('active=true&sort=price_asc'), ['Tea', 'Rice', 'Oil'])
        self.assertEqual(names('active=true&sort=stock_desc'), ['Rice', 'Tea', 'Oil'])
        self.assertEqual(names('search=SECRET'), [])
        self.assertEqual(self.call('get', base + '?sort=bad').status_code, 400)
        summary = self.call('get', base + 'summary/')
        self.assertEqual(summary.json(), {'active_products': 3, 'low_stock': 1, 'out_of_stock': 1})
        self.assertEqual(self.call('get', base + 'summary/', token=self.other_token).status_code, 404)

    def test_sale_catalog_and_barcode_stock_follow_selected_location(self):
        shop = StockLocation.objects.get(business=self.business, is_default=True)
        warehouse = StockLocation.objects.create(business=self.business, name='Warehouse', type='warehouse')
        other_shop = StockLocation.objects.get(business=self.other_business, is_default=True)
        rice = Product.objects.create(business=self.business, name='Rice', sku='RICE', barcode='RICE-CODE', retail_price=Decimal('50'))
        phone = Product.objects.create(business=self.business, name='Phone', sku='PHONE', product_type='variant')
        blue = ProductVariant.objects.create(business=self.business, product=phone, label='Blue', sku='PHONE-BLUE',
                                             barcode='BLUE-CODE', combination_key='blue', retail_price=Decimal('100'))
        red = ProductVariant.objects.create(business=self.business, product=phone, label='Red', sku='PHONE-RED',
                                            barcode='RED-CODE', combination_key='red', retail_price=Decimal('100'))
        StockBalance.objects.create(business=self.business, product=rice, variant=rice.variants.get(),
                                    location=warehouse, quantity=Decimal('4'))
        StockBalance.objects.create(business=self.business, product=phone, variant=blue,
                                    location=warehouse, quantity=Decimal('2'))
        StockBalance.objects.create(business=self.business, product=phone, variant=red,
                                    location=shop, quantity=Decimal('3'))
        base = self.base + 'products/'
        shop_items = self.call('get', base + f'?location_id={shop.pk}&stock=in_stock').json()['products']
        self.assertEqual([item['name'] for item in shop_items], ['Phone'])
        self.assertEqual([(row['label'], row['sellable_stock']) for row in shop_items[0]['variants']],
                         [('Blue', '0'), ('Red', '3')])
        warehouse_items = self.call('get', base + f'?location_id={warehouse.pk}&stock=in_stock').json()['products']
        self.assertEqual([item['name'] for item in warehouse_items], ['Phone', 'Rice'])
        self.assertEqual(warehouse_items[0]['variants'][0]['sellable_stock'], '2')
        self.assertEqual(self.call('get', base + f'?location_id={shop.pk}&stock=in_stock&search=RICE').json()['products'], [])
        lookup = base + 'barcodes/lookup/?code=RICE-CODE&location_id='
        self.assertEqual(self.call('get', lookup + str(shop.pk)).json()['target']['sellable_stock'], '0')
        self.assertEqual(self.call('get', lookup + str(warehouse.pk)).json()['target']['sellable_stock'], '4')
        self.assertEqual(self.call('get', base + f'?location_id={other_shop.pk}').status_code, 404)
        self.assertEqual(self.call('get', lookup + str(other_shop.pk)).status_code, 404)

    def test_opening_stock_atomic_multiple_locations_and_receipt_retry(self):
        location = StockLocation.objects.get(business=self.business, is_default=True)
        warehouse = StockLocation.objects.create(business=self.business, name='Godown', type='warehouse')
        command = uuid.uuid4()
        created = self.call('post', self.base + 'products/', {'name': 'Rice', 'opening_stock': {
            'quantity': '12.500', 'unit_cost': '25.2500', 'location_id': warehouse.pk}}, command=command)
        self.assertEqual(created.status_code, 201, created.content)
        product_id = created.json()['product']['id']
        self.assertEqual(self.call('get', self.base + f'products/{product_id}/').json()['stock']['physical'], '12.500')
        self.assertEqual(StockBalance.objects.get(product_id=product_id, location=warehouse).quantity, Decimal('12.500'))
        self.assertEqual(StockMovement.objects.filter(product_id=product_id).count(), 1)
        self.assertEqual(self.call('post', self.base + 'products/', {'name': 'Rice'}, command=command).status_code, 200)
        self.assertEqual(StockMovement.objects.filter(product_id=product_id).count(), 1)
        receipt = {'product_id': product_id, 'location_id': location.pk, 'quantity': '2.000', 'unit_cost': '27.0000', 'reason': 'Count gain', 'financial_reason': 'count_gain'}
        receipt_id = uuid.uuid4()
        first = self.call('post', self.base + 'stock/receipts/', receipt, command=receipt_id)
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(self.call('post', self.base + 'stock/receipts/', receipt, command=receipt_id).status_code, 201)
        self.assertEqual(StockMovement.objects.filter(product_id=product_id).count(), 2)
        self.assertEqual(self.call('get', self.base + f'locations/{location.pk}/stock/').json()['stock'][0]['quantity'], '2.000')
        failed = self.call('post', self.base + 'products/', {'name': 'Bad', 'opening_stock': {
            'quantity': '3', 'unit_cost': '1', 'location_id': 999999}}, command=uuid.uuid4())
        self.assertEqual(failed.status_code, 400)
        self.assertFalse(Product.objects.filter(business=self.business, name='Bad').exists())

    def test_package_batch_expiry_waste_and_transfer(self):
        shop = StockLocation.objects.get(business=self.business, is_default=True)
        warehouse = StockLocation.objects.create(business=self.business, name='Godown', type='warehouse')
        product_id = self.call('post', self.base + 'products/', {'name': 'Eggs', 'tracking_mode': 'expiry'}, command=uuid.uuid4()).json()['product']['id']
        package = self.call('post', self.base + f'products/{product_id}/units/', {'name': 'Tray', 'factor': '30.000'})
        self.assertEqual(package.status_code, 201, package.content)
        unit_id = package.json()['unit']['id']
        expired = self.call('post', self.base + f'products/{product_id}/batches/', {'lot_code': 'OLD', 'expires_on': '2020-01-01'})
        self.assertEqual(expired.status_code, 201, expired.content)
        fresh = self.call('post', self.base + f'products/{product_id}/batches/', {'lot_code': 'NEW', 'expires_on': '2099-01-01'})
        self.assertEqual(fresh.status_code, 201, fresh.content)
        old_id, new_id = expired.json()['batch']['id'], fresh.json()['batch']['id']
        self.assertEqual(len(self.call('get', self.base + f'products/{product_id}/batches/').json()['batches']), 2)
        for batch_id in (old_id, new_id):
            receipt = self.call('post', self.base + 'stock/receipts/', {
                'product_id': product_id, 'location_id': shop.pk, 'quantity': '2', 'unit_cost': '5',
                'unit_id': unit_id, 'batch_id': batch_id, 'reason': 'Count gain', 'financial_reason': 'count_gain'}, command=uuid.uuid4())
            self.assertEqual(receipt.status_code, 201, receipt.content)
        detail = self.call('get', self.base + f'products/{product_id}/').json()
        self.assertEqual(detail['stock']['physical'], '120.000')
        self.assertEqual(detail['stock']['sellable'], '60.000')
        self.assertEqual(detail['stock']['expired'], '60.000')
        recommendation = self.call('get', self.base + f'products/{product_id}/fefo/?location_id={shop.pk}')
        self.assertEqual(recommendation.json()['recommended_batch_ids'], [new_id])
        selection_path = self.base + f'products/{product_id}/batch-selection/'
        self.assertEqual(self.call('post', selection_path, {'location_id': shop.pk, 'batch_id': old_id, 'quantity': '1'}).status_code, 409)
        self.assertEqual(self.call('post', selection_path, {'location_id': shop.pk, 'batch_id': new_id, 'quantity': '1'}).status_code, 200)
        transfer_id = uuid.uuid4()
        transfer = {'product_id': product_id, 'location_id': shop.pk, 'destination_id': warehouse.pk,
                    'quantity': '1', 'unit_id': unit_id, 'batch_id': new_id}
        self.assertEqual(self.call('post', self.base + 'stock/transfers/', transfer, command=transfer_id).status_code, 201)
        self.assertEqual(self.call('post', self.base + 'stock/transfers/', transfer, command=transfer_id).status_code, 201)
        self.assertEqual(self.call('get', self.base + f'products/{product_id}/').json()['stock']['physical'], '120.000')
        waste_id = uuid.uuid4()
        waste = {'product_id': product_id, 'location_id': warehouse.pk, 'quantity': '10', 'batch_id': new_id, 'reason': 'broken'}
        first = self.call('post', self.base + 'stock/waste/', waste, command=waste_id)
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(first.json()['inventory_cost'], '50.0000000')
        self.assertEqual(self.call('post', self.base + 'stock/waste/', waste, command=waste_id).status_code, 201)
        self.assertEqual(self.call('get', self.base + f'products/{product_id}/').json()['stock']['physical'], '110.000')
        self.assertEqual(Decimal(self.call('get', self.base + f'products/{product_id}/').json()['stock']['inventory_value']), Decimal('550'))
        too_much = self.call('post', self.base + 'stock/waste/', {**waste, 'quantity': '100'}, command=uuid.uuid4())
        self.assertEqual(too_much.status_code, 409)
        self.assertEqual(AuditEvent.objects.filter(product_id=product_id, entity_type='batch', action='created').count(), 2)
        self.assertEqual(AuditEvent.objects.filter(product_id=product_id, action='transfer').count(), 2)
        self.assertEqual(AuditEvent.objects.filter(product_id=product_id, action='waste').count(), 1)

    def test_tracking_conversion_preserves_stock_and_audit_history(self):
        created = self.call('post', self.base + 'products/', {'name': 'Milk', 'opening_stock': {
            'quantity': '5', 'unit_cost': '20'}}, command=uuid.uuid4())
        self.assertEqual(created.status_code, 201, created.content)
        product_id = created.json()['product']['id']
        path = self.base + f'products/{product_id}/convert-tracking/'
        command = uuid.uuid4()
        converted = self.call('post', path, {'tracking_mode': 'expiry', 'lot_code': 'M1', 'expires_on': '2099-01-01'}, command=command)
        self.assertEqual(converted.status_code, 200, converted.content)
        self.assertEqual(self.call('post', path, {'tracking_mode': 'expiry'}, command=command).status_code, 200)
        self.assertEqual(self.call('get', self.base + f'products/{product_id}/').json()['stock']['physical'], '5.000')
        self.assertEqual(StockMovement.objects.filter(product_id=product_id, type='tracking_conversion').count(), 1)
        self.assertEqual(AuditEvent.objects.filter(product_id=product_id, action='tracking_changed').count(), 1)
        self.assertEqual(StockBalance.objects.get(product_id=product_id).batch.lot_code, 'M1')
        self.assertEqual(self.call('patch', self.base + f'products/{product_id}/', {'tracking_mode': 'simple'}).status_code, 400)

    def test_catalog_staff_can_create_but_stock_permission_is_enforced(self):
        employee = User.objects.create_user(phone='01611111111', password='ExamplePass#83')
        BusinessMember.objects.create(user=employee, business=self.business, role=BusinessMember.EMPLOYEE,
                                      can_post_stock=False)
        token = self.login('01611111111')
        plain = self.call('post', self.base + 'products/', {'name': 'Plain'}, token=token, command=uuid.uuid4())
        self.assertEqual(plain.status_code, 201)
        blocked = self.call('post', self.base + 'products/', {'name': 'With stock', 'opening_stock': {
            'quantity': '1', 'unit_cost': '10'}}, token=token, command=uuid.uuid4())
        self.assertEqual(blocked.status_code, 403)
        self.assertFalse(Product.objects.filter(business=self.business, name='With stock').exists())

    def test_image_upload_authorization_and_replace(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            self.check_image_upload_authorization_and_replace()

    def check_image_upload_authorization_and_replace(self):
        product_id = self.call('post', self.base + 'products/', {'name': 'Photo'}, command=uuid.uuid4()).json()['product']['id']
        path = self.base + f'products/{product_id}/image/'

        def png(color):
            data = io.BytesIO()
            Image.new('RGB', (12, 12), color).save(data, format='PNG')
            data.seek(0)
            data.name = 'photo.png'
            return data

        denied = self.client.post(path, {'image': png('red')}, HTTP_AUTHORIZATION=f'Bearer {self.other_token}')
        self.assertEqual(denied.status_code, 404)
        first = self.client.post(path, {'image': png('red')}, HTTP_AUTHORIZATION=f'Bearer {self.token}')
        self.assertEqual(first.status_code, 200, first.content)
        old_key = Product.objects.get(pk=product_id).image_key
        self.assertTrue(old_key.endswith('.webp'))
        second = self.client.post(path, {'image': png('blue')}, HTTP_AUTHORIZATION=f'Bearer {self.token}')
        self.assertEqual(second.status_code, 200, second.content)
        self.assertNotEqual(Product.objects.get(pk=product_id).image_key, old_key)
        removed = self.client.delete(path, HTTP_AUTHORIZATION=f'Bearer {self.token}')
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(Product.objects.get(pk=product_id).image_key, '')
        self.assertEqual(list(AuditEvent.objects.filter(product_id=product_id, action__startswith='image_')
                             .order_by('created_at').values_list('action', flat=True)),
                         ['image_added', 'image_replaced', 'image_removed'])
