import json
from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.db import connection
from django.test import TestCase

from accounts.models import Business, BusinessMember, User

from .models import StockLocation
from .models import StockBalance, StockMovement
from .services import StockError, receive, post_waste
from products.models import Product, StockBatch
from django.test import TransactionTestCase
from django.db import close_old_connections, transaction
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone
import uuid
from unittest import skipUnless


class LocationApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        self.employee = User.objects.create_user(phone='01812345678', password='StaffPass#83')
        self.outsider = User.objects.create_user(phone='01912345678', password='OtherPass#83')
        self.business = Business.objects.create(name='Rahman Traders')
        self.other_business = Business.objects.create(name='Other Shop')
        BusinessMember.objects.create(user=self.owner, business=self.business, role=BusinessMember.OWNER)
        self.staff_member = BusinessMember.objects.create(
            user=self.employee, business=self.business, role=BusinessMember.EMPLOYEE
        )
        BusinessMember.objects.create(user=self.outsider, business=self.other_business, role=BusinessMember.OWNER)
        self.owner_token = self.login('01712345678', 'OwnerPass#83')
        self.staff_token = self.login('01812345678', 'StaffPass#83')
        self.outsider_token = self.login('01912345678', 'OtherPass#83')
        self.list_path = f'/api/v1/businesses/{self.business.id}/locations/'
        self.default = StockLocation.objects.get(business=self.business, is_default=True)

    def login(self, phone, password):
        response = self.client.post('/api/v1/auth/login/',
                                    data=json.dumps({'phone': phone, 'password': password}),
                                    content_type='application/json')
        self.assertEqual(response.status_code, 200)
        return response.json()['token']

    def request(self, method, path, token=None, data=None):
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'} if token else {}
        payload = {'data': json.dumps(data), 'content_type': 'application/json'} if data is not None else {}
        return getattr(self.client, method)(path, **payload, **headers)

    def test_default_location_for_each_business_and_list_isolation(self):
        self.assertEqual(StockLocation.objects.filter(business=self.business, is_default=True).count(), 1)
        self.assertEqual(StockLocation.objects.filter(business=self.other_business, is_default=True).count(), 1)
        self.assertEqual(self.default.name, 'Main Shop')
        self.assertTrue(self.default.is_active)
        response = self.request('get', self.list_path, self.owner_token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['id'] for item in response.json()['locations']], [self.default.id])
        self.assertTrue(response.json()['can_manage_locations'])
        self.assertEqual(self.request('get', self.list_path, self.outsider_token).status_code, 404)
        self.assertEqual(self.request('get', self.list_path).status_code, 401)

    def test_location_overview_uses_variant_stock_and_cost_layers(self):
        product = Product.objects.create(business=self.business, name='Soap', sku='SOAP-1',
                                         base_unit='Piece', retail_price=Decimal('5.00'),
                                         purchase_price=Decimal('2.00'), minimum_stock=Decimal('4'))
        receive(product, self.default, Decimal('3'), Decimal('2'), self.owner, uuid.uuid4())
        path = f'{self.list_path}{self.default.id}/overview/'
        response = self.request('get', path, self.owner_token)
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(Decimal(payload['summary']['inventory_value']), Decimal('6'))
        self.assertEqual({key: payload['summary'][key] for key in ('sku_count', 'low_stock_count', 'expiring_soon_count')},
                         {'sku_count': 1, 'low_stock_count': 1, 'expiring_soon_count': 0})
        row = payload['inventory'][0]
        self.assertEqual(row['available_quantity'], '3.000')
        self.assertEqual(Decimal(row['stock_value']), Decimal('15'))
        self.assertEqual(Decimal(row['purchase_cost']), Decimal('6'))
        self.assertIsNone(row['returning_quantity'])
        self.assertIsNone(row['shortage_quantity'])
        self.assertEqual(self.request('get', path, self.outsider_token).status_code, 404)

    def test_location_movements_fetch_ten_more_without_duplicates(self):
        product = Product.objects.create(business=self.business, name='Soap', sku='SOAP-2', base_unit='Piece')
        for _ in range(12):
            receive(product, self.default, Decimal('1'), Decimal('2'), self.owner, uuid.uuid4())
        path = f'{self.list_path}{self.default.id}/movements/'
        first = self.request('get', path + '?page=1', self.owner_token).json()
        second = self.request('get', path + '?page=2', self.owner_token).json()
        self.assertEqual((len(first['movements']), first['next_page']), (10, 2))
        self.assertEqual((len(second['movements']), second['next_page']), (2, None))
        self.assertEqual(len({item['id'] for item in first['movements'] + second['movements']}), 12)
        self.assertEqual(self.request('get', path + '?page=0', self.owner_token).status_code, 400)

    def test_location_overview_excludes_expired_stock_from_available_quantity(self):
        product = Product.objects.create(business=self.business, name='Milk', sku='MILK-1',
                                         retail_price=Decimal('10.00'), tracking_mode='expiry')
        variant = product.variants.get(is_default=True)
        expired = StockBatch.objects.create(product=product, variant=variant, lot_code='OLD',
                                            expires_on=timezone.localdate() - timedelta(days=1))
        soon = StockBatch.objects.create(product=product, variant=variant, lot_code='SOON',
                                         expires_on=timezone.localdate() + timedelta(days=2))
        receive(product, self.default, Decimal('2'), Decimal('3'), self.owner, uuid.uuid4(), batch=expired)
        receive(product, self.default, Decimal('3'), Decimal('3'), self.owner, uuid.uuid4(), batch=soon)
        payload = self.request('get', f'{self.list_path}{self.default.id}/overview/', self.owner_token).json()
        self.assertEqual(payload['summary']['expiring_soon_count'], 1)
        self.assertEqual(payload['inventory'][0]['physical_quantity'], '5.000')
        self.assertEqual(payload['inventory'][0]['available_quantity'], '3.000')
        self.assertEqual(Decimal(payload['inventory'][0]['stock_value']), Decimal('30'))

    def test_backfill_creates_default_for_existing_business(self):
        StockLocation.objects.filter(business=self.business, is_default=True).delete()
        self.assertFalse(StockLocation.objects.filter(business=self.business).exists())
        migration = import_module('stockkeeper.migrations.0002_backfill_default_locations')
        migration.create_defaults(apps, SimpleNamespace(connection=connection))
        migration.create_defaults(apps, SimpleNamespace(connection=connection))
        self.assertEqual(StockLocation.objects.filter(business=self.business, is_default=True).count(), 1)

    def test_permission_migration_grants_existing_employees(self):
        self.staff_member.can_manage_locations = False
        self.staff_member.can_post_stock = False
        self.staff_member.save(update_fields=['can_manage_locations', 'can_post_stock'])
        migration = import_module('accounts.migrations.0004_stock_permissions')
        migration.grant_existing_employees(apps, SimpleNamespace(connection=connection))
        self.staff_member.refresh_from_db()
        self.assertTrue(self.staff_member.can_manage_locations)
        self.assertTrue(self.staff_member.can_post_stock)

    def test_owner_create_edit_and_deactivate_without_deleting_history(self):
        create = self.request('post', self.list_path, self.owner_token, {
            'name': 'Mirpur Godown', 'type': 'warehouse', 'address': 'Mirpur, Dhaka',
        })
        self.assertEqual(create.status_code, 201, create.content)
        location_id = create.json()['location']['id']
        path = f'{self.list_path}{location_id}/'
        edit = self.request('patch', path, self.owner_token, {'name': 'North Godown', 'address': ''})
        self.assertEqual(edit.status_code, 200, edit.content)
        self.assertEqual(edit.json()['location']['name'], 'North Godown')
        deactivate = self.request('patch', path, self.owner_token, {'is_active': False})
        self.assertEqual(deactivate.status_code, 200, deactivate.content)
        self.assertFalse(deactivate.json()['location']['is_active'])
        self.assertEqual(self.request('delete', path, self.owner_token).status_code, 405)
        self.assertEqual(self.request('get', path, self.owner_token).json()['location']['is_active'], False)
        self.assertEqual(self.request('patch', path, self.owner_token, {'is_active': True}).status_code, 200)

    def test_default_cannot_be_deactivated_and_duplicate_names_rejected(self):
        default_path = f'{self.list_path}{self.default.id}/'
        self.assertEqual(self.request('patch', default_path, self.owner_token, {'is_active': False}).status_code, 409)
        self.assertEqual(self.request('post', self.list_path, self.owner_token,
                                      {'name': 'main shop', 'type': 'shop', 'address': 'Main Shop, Dhaka'}).status_code, 409)
        self.assertEqual(self.request('post', self.list_path, self.owner_token,
                                      {'name': 'Address required', 'type': 'shop'}).status_code, 400)
        self.assertEqual(self.request('post', self.list_path, self.owner_token,
                                      {'name': 'New', 'type': 'invalid'}).status_code, 400)
        self.assertEqual(StockLocation.objects.filter(business=self.business).count(), 1)

    def test_employee_permission_and_cross_business_detail_access(self):
        self.assertTrue(self.request('get', self.list_path, self.staff_token).json()['can_manage_locations'])
        self.assertTrue(self.staff_member.can_post_stock)
        permission_path = f'/api/v1/businesses/{self.business.id}/employees/{self.employee.id}/permissions/'
        self.assertEqual(self.request('patch', permission_path, self.staff_token,
                                      {'can_manage_locations': True}).status_code, 403)
        self.assertEqual(self.request('patch', permission_path, self.owner_token,
                                      {'can_manage_locations': 'yes'}).status_code, 400)
        granted = self.request('patch', permission_path, self.owner_token, {'can_manage_locations': True})
        self.assertEqual(granted.status_code, 200, granted.content)
        self.assertTrue(granted.json()['employee']['can_manage_locations'])
        self.assertEqual(self.request('post', self.list_path, self.staff_token,
                                      {'name': 'Branch', 'type': 'shop', 'address': 'Branch, Dhaka'}).status_code, 201)
        other_location = StockLocation.objects.get(business=self.other_business, is_default=True)
        self.assertEqual(self.request('get', f'{self.list_path}{other_location.id}/', self.staff_token).status_code, 404)
        self.assertEqual(self.request('patch', permission_path, self.owner_token,
                                      {'can_manage_locations': False}).status_code, 200)
        self.assertEqual(self.request('post', self.list_path, self.staff_token,
                                      {'name': 'Blocked', 'type': 'shop'}).status_code, 403)
        revoked = self.request('patch', permission_path, self.owner_token, {'can_post_stock': False})
        self.assertEqual(revoked.status_code, 200)
        self.assertFalse(revoked.json()['employee']['can_post_stock'])
        self.assertEqual(self.request('patch', permission_path, self.owner_token,
                                      {'can_post_stock': 'no'}).status_code, 400)

    def test_default_switch_is_scoped_and_preserves_one_active_default(self):
        create = self.request('post', self.list_path, self.staff_token, {
            'name': 'Godown', 'type': 'warehouse',
        })
        self.assertEqual(create.status_code, 201)
        target_id = create.json()['location']['id']
        command = f'{self.list_path}{target_id}/set-default/'
        self.assertEqual(self.request('post', command, self.outsider_token).status_code, 404)
        self.assertEqual(self.request('post', command).status_code, 401)
        self.assertEqual(self.request('post', command, self.staff_token).status_code, 200)
        self.assertEqual(self.request('post', command, self.staff_token).status_code, 200)
        self.assertEqual(StockLocation.objects.filter(business=self.business, is_default=True).count(), 1)
        self.assertFalse(StockLocation.objects.get(pk=self.default.pk).is_default)
        self.assertEqual(self.request('patch', f'{self.list_path}{target_id}/', self.owner_token,
                                      {'is_active': False}).status_code, 409)
        self.assertEqual(self.request('post', f'{self.list_path}{self.default.pk}/set-default/',
                                      self.owner_token).status_code, 200)
        self.assertEqual(self.request('patch', f'{self.list_path}{target_id}/', self.owner_token,
                                      {'is_active': False}).status_code, 200)
        self.assertEqual(self.request('post', command, self.owner_token).status_code, 409)
        self.assertEqual(StockLocation.objects.filter(business=self.business, is_default=True,
                                                     is_active=True).count(), 1)

    def test_revoked_employee_cannot_switch_default(self):
        location = StockLocation.objects.create(business=self.business, name='Second', type='shop')
        permission_path = f'/api/v1/businesses/{self.business.id}/employees/{self.employee.id}/permissions/'
        self.assertEqual(self.request('patch', permission_path, self.owner_token,
                                      {'can_manage_locations': False}).status_code, 200)
        response = self.request('post', f'{self.list_path}{location.id}/set-default/', self.staff_token)
        self.assertEqual(response.status_code, 403)
        self.assertTrue(StockLocation.objects.get(pk=self.default.pk).is_default)

    def test_patch_preflight_for_web_preview(self):
        response = self.client.options(
            f'{self.list_path}{self.default.id}/',
            HTTP_ORIGIN='http://localhost:8082',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='PATCH',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization,content-type',
        )
        self.assertEqual(response.status_code, 204)
        self.assertIn('PATCH', response['Access-Control-Allow-Methods'])
        self.assertEqual(response['Access-Control-Allow-Origin'], 'http://localhost:8082')


class ConcurrentStockTests(TransactionTestCase):
    @skipUnless(connection.vendor == 'postgresql', 'SQLite has no row-level select_for_update locking.')
    def test_two_deductions_cannot_oversell_one_balance(self):
        user = User.objects.create_user(phone='01722222222', password='ExamplePass#83')
        business = Business.objects.create(name='Concurrent Shop')
        location = StockLocation.objects.get(business=business, is_default=True)
        product = Product.objects.create(business=business, name='Item', sku='I-1')
        with transaction.atomic():
            receive(product, location, Decimal('5'), Decimal('12'), user, uuid.uuid4())

        def deduct(_):
            close_old_connections()
            try:
                return post_waste(product, location, Decimal('5'), user, uuid.uuid4(), 'damaged')
            except StockError:
                return None
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(deduct, range(2)))
        self.assertEqual(sum(value is not None for value in outcomes), 1)
        self.assertEqual(StockBalance.objects.get(product=product, location=location).quantity, Decimal('0'))
        self.assertEqual(StockMovement.objects.filter(product=product, type='waste').count(), 1)
