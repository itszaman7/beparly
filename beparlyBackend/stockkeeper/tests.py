import json
from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.db import connection
from django.test import TestCase

from accounts.models import Business, BusinessMember, User

from .models import StockLocation


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
                                      {'name': 'main shop', 'type': 'shop'}).status_code, 409)
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
                                      {'name': 'Branch', 'type': 'shop'}).status_code, 201)
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
