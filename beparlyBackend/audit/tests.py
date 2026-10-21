import json
import uuid

from django.test import TestCase

from accounts.models import Business, BusinessMember, User

from .models import AuditEvent


class AuditApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01711111111', password='ExamplePass#83', first_name='Rahim')
        self.other = User.objects.create_user(phone='01811111111', password='ExamplePass#83')
        self.business = Business.objects.create(name='First Shop')
        self.other_business = Business.objects.create(name='Second Shop')
        BusinessMember.objects.create(user=self.owner, business=self.business, role=BusinessMember.OWNER)
        BusinessMember.objects.create(user=self.other, business=self.other_business, role=BusinessMember.OWNER)
        self.token = self.login('01711111111')
        self.other_token = self.login('01811111111')
        self.base = f'/api/v1/businesses/{self.business.pk}/'

    def login(self, phone):
        return self.client.post('/api/v1/auth/login/', json.dumps({
            'phone': phone, 'password': 'ExamplePass#83',
        }), content_type='application/json').json()['token']

    def call(self, method, path, data=None, token=None, command=None):
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token or self.token}'}
        if command:
            headers['HTTP_X_COMMAND_ID'] = str(command)
        if data is None:
            return getattr(self.client, method)(path, **headers)
        return getattr(self.client, method)(path, json.dumps(data), content_type='application/json', **headers)

    def test_catalog_edits_record_actor_time_changes_and_isolation(self):
        category = self.call('post', self.base + 'categories/', {'name': 'Computer'})
        self.assertEqual(category.status_code, 201)
        category_id = category.json()['category']['id']
        created = self.call('post', self.base + 'products/', {
            'name': 'Laptop', 'category': category_id, 'purchase_price': '800.00',
        }, command=uuid.uuid4())
        self.assertEqual(created.status_code, 201, created.content)
        product_id = created.json()['product']['id']
        changed = self.call('patch', self.base + f'products/{product_id}/', {'retail_price': '1000.00'})
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(self.call('post', self.base + f'products/{product_id}/units/', {
            'name': 'Carton', 'factor': '12',
        }).status_code, 201)
        events = self.call('get', self.base + f'audit/?product_id={product_id}')
        self.assertEqual(events.status_code, 200)
        rows = events.json()['events']
        self.assertEqual([row['entity_type'] for row in rows], ['package', 'product', 'product'])
        self.assertEqual(rows[1]['changes']['retail_price'], {'before': None, 'after': '1000.00'})
        self.assertTrue(all(row['actor'] == 'Rahim' and row['created_at'] for row in rows))
        self.assertEqual(self.call('get', self.base + 'audit/', token=self.other_token).status_code, 404)
        self.assertEqual(self.call('get', self.base + 'audit/?product_id=bad').status_code, 400)
        self.assertEqual(self.call('get', self.base + f'audit/?product_id={uuid.uuid4()}').json()['events'], [])

    def test_locations_stock_and_retry_are_audited_once(self):
        location = self.call('post', self.base + 'locations/', {'name': 'Warehouse', 'type': 'warehouse', 'address': ''})
        self.assertEqual(location.status_code, 201, location.content)
        location_id = location.json()['location']['id']
        self.assertEqual(self.call('patch', self.base + f'locations/{location_id}/', {'address': 'Dhaka'}).status_code, 200)
        self.assertEqual(self.call('post', self.base + f'locations/{location_id}/set-default/', {}).status_code, 200)
        location_events = self.call('get', self.base + f'audit/?location_id={location_id}').json()['events']
        self.assertEqual([row['action'] for row in location_events], ['updated', 'updated', 'created'])
        self.assertTrue(all(row['actor'] == 'Rahim' for row in location_events))

        command = uuid.uuid4()
        product = self.call('post', self.base + 'products/', {
            'name': 'Rice', 'opening_stock': {'quantity': '5', 'unit_cost': '20', 'location_id': location_id},
        }, command=command)
        self.assertEqual(product.status_code, 201, product.content)
        product_id = product.json()['product']['id']
        self.assertEqual(self.call('post', self.base + 'products/', {'name': 'Rice'}, command=command).status_code, 200)
        self.assertEqual(AuditEvent.objects.filter(business=self.business, product_id=product_id, action='opening').count(), 1)
        self.assertEqual(AuditEvent.objects.filter(business=self.business, product_id=product_id, action='created').count(), 1)

        waste_id = uuid.uuid4()
        waste = {'product_id': product_id, 'location_id': location_id, 'quantity': '1', 'reason': 'damaged'}
        self.assertEqual(self.call('post', self.base + 'stock/waste/', waste, command=waste_id).status_code, 201)
        self.assertEqual(self.call('post', self.base + 'stock/waste/', waste, command=waste_id).status_code, 201)
        self.assertEqual(AuditEvent.objects.filter(business=self.business, product_id=product_id, action='waste').count(), 1)
        activity = self.call('get', self.base + f'audit/?product_id={product_id}').json()['events']
        self.assertEqual(activity[0]['changes']['quantity_change'], '-1.000')

    def test_audit_event_cannot_be_edited_or_deleted(self):
        event = AuditEvent.objects.filter(business=self.business).first()
        self.assertIsNotNone(event)
        event.subject = 'Changed'
        with self.assertRaises(ValueError):
            event.save()
        with self.assertRaises(ValueError):
            event.delete()
