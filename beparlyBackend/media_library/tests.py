import io
import json
import tempfile
import uuid

from django.test import TestCase, override_settings
from django.core.files.storage import default_storage
from PIL import Image

from accounts.models import Business, BusinessMember, User
from accounting.models import Contact
from audit.models import AuditEvent
from products.models import Product

from .models import MediaAsset


class MediaLibraryTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01733333333', password='ExamplePass#83')
        self.staff = User.objects.create_user(phone='01833333333', password='ExamplePass#83')
        self.outsider = User.objects.create_user(phone='01933333333', password='ExamplePass#83')
        self.business = Business.objects.create(name='One')
        other = Business.objects.create(name='Two')
        BusinessMember.objects.create(user=self.owner, business=self.business, role='owner')
        BusinessMember.objects.create(user=self.staff, business=self.business, role='employee')
        BusinessMember.objects.create(user=self.outsider, business=other, role='owner')
        self.product = Product.objects.create(business=self.business, name='Tea', sku='tea')
        self.supplier = Contact.objects.create(business=self.business, name='Supplier', is_supplier=True)
        self.base = f'/api/v1/businesses/{self.business.pk}/media/'
        self.tokens = {}
        for user in (self.owner, self.staff, self.outsider):
            response = self.client.post('/api/v1/auth/login/',
                                        json.dumps({'phone': user.phone, 'password': 'ExamplePass#83'}),
                                        content_type='application/json')
            self.tokens[user.pk] = response.json()['token']

    def auth(self, user):
        return {'HTTP_AUTHORIZATION': f'Bearer {self.tokens[user.pk]}'}

    def json_post(self, path, data, user):
        return self.client.post(path, json.dumps(data), content_type='application/json', **self.auth(user))

    def photo(self):
        content = io.BytesIO()
        Image.new('RGB', (12, 12), 'red').save(content, format='PNG')
        content.seek(0)
        content.name = 'red.png'
        return content

    def test_owner_upload_staff_reuse_and_delete_detaches_all(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            uploaded = self.client.post(self.base, {'image': self.photo()}, **self.auth(self.owner))
            self.assertEqual(uploaded.status_code, 201, uploaded.content)
            image_id = uploaded.json()['image']['id']
            stored_key = MediaAsset.objects.get(pk=image_id).key
            self.assertTrue(default_storage.exists(stored_key))
            self.assertEqual(self.client.get(self.base, **self.auth(self.staff)).status_code, 200)
            self.assertEqual(self.client.post(self.base, {'image': self.photo()}, **self.auth(self.staff)).status_code, 403)
            attached = self.json_post(self.base + image_id + '/attach/',
                                      {'kind': 'product', 'target_id': str(self.product.pk)}, self.staff)
            self.assertEqual(attached.status_code, 200, attached.content)
            self.assertEqual(self.json_post(self.base + image_id + '/attach/',
                             {'kind': 'supplier', 'target_id': str(self.supplier.pk)}, self.staff).status_code, 403)
            self.assertEqual(self.json_post(self.base + image_id + '/attach/',
                             {'kind': 'supplier', 'target_id': str(self.supplier.pk)}, self.owner).status_code, 200)
            self.assertEqual(self.json_post(self.base + image_id + '/attach/',
                             {'kind': 'business_logo', 'target_id': str(self.business.pk)}, self.owner).status_code, 200)
            detail = self.client.get(self.base + image_id + '/', **self.auth(self.owner)).json()['image']
            self.assertEqual(len(detail['used_by']['products']), 1)
            self.assertEqual(len(detail['used_by']['suppliers']), 1)
            self.assertTrue(detail['used_by']['business_logo'])
            self.assertEqual(self.json_post(self.base + 'delete/', {'ids': [image_id]}, self.staff).status_code, 403)
            with self.captureOnCommitCallbacks(execute=True):
                removed = self.json_post(self.base + 'delete/', {'ids': [image_id]}, self.owner)
            self.assertEqual(removed.status_code, 200, removed.content)
            self.product.refresh_from_db(); self.supplier.refresh_from_db(); self.business.refresh_from_db()
            self.assertEqual(self.product.image_key, '')
            self.assertEqual(self.supplier.image_key, '')
            self.assertFalse(self.business.logo)
            self.assertFalse(MediaAsset.objects.filter(pk=image_id).exists())
            self.assertFalse(default_storage.exists(stored_key))
            self.assertEqual(AuditEvent.objects.filter(business=self.business, entity_type='media', action='deleted').count(), 1)

    def test_other_business_cannot_read_or_attach(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            image_id = self.client.post(self.base, {'image': self.photo()}, **self.auth(self.owner)).json()['image']['id']
            self.assertEqual(self.client.get(self.base + image_id + '/', **self.auth(self.outsider)).status_code, 404)
            self.assertEqual(self.json_post(self.base + image_id + '/attach/',
                             {'kind': 'product', 'target_id': str(self.product.pk)}, self.outsider).status_code, 404)
            self.assertEqual(self.json_post(self.base + 'delete/', {'ids': [image_id]}, self.outsider).status_code, 404)

    def test_product_photo_retry_does_not_duplicate_asset_or_audit(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            path = f'/api/v1/businesses/{self.business.pk}/products/{self.product.pk}/image/'
            headers = {**self.auth(self.owner), 'HTTP_X_COMMAND_ID': str(uuid.uuid4())}
            first = self.client.post(path, {'image': self.photo()}, **headers)
            self.assertEqual(first.status_code, 200, first.content)
            second = self.client.post(path, {'image': self.photo()}, **headers)
            self.assertEqual(second.status_code, 200, second.content)
            self.assertEqual(MediaAsset.objects.filter(business=self.business).count(), 1)
            self.assertEqual(AuditEvent.objects.filter(business=self.business, entity_type='product', action='image_added').count(), 1)
