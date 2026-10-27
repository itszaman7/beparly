import base64
import hashlib
import hmac
from unittest.mock import Mock, patch

from django.core.files.base import ContentFile
from django.test import Client
from django.test import SimpleTestCase, override_settings

from .bunny_storage import BunnyImageStorage, BunnyPrivateStorage
from products.views import delete_unreferenced_image
from sales.image_snapshots import snapshot_url, snapshot_value


BUNNY_ENV = {
    'BUNNY_STORAGE_ZONE': 'example-zone',
    'BUNNY_STORAGE_PASSWORD': 'storage-secret',
    'BUNNY_STORAGE_HOST': 'https://storage.bunnycdn.com',
    'BUNNY_CDN_BASE_URL': 'https://images.example.com',
    'BUNNY_CDN_TOKEN_KEY': 'token-secret',
    'BUNNY_CDN_URL_TTL': '3600',
}


class BunnyStorageTests(SimpleTestCase):
    @patch.dict('os.environ', BUNNY_ENV)
    @patch('beparlyBackend.bunny_storage.time.time', return_value=1000)
    def test_image_url_has_exact_path_signature(self, _clock):
        path = '/products/photo.png'
        expected = base64.urlsafe_b64encode(hmac.new(
            b'token-secret', f'{path}4600'.encode(), hashlib.sha256).digest()
        ).rstrip(b'=').decode()
        self.assertEqual(BunnyImageStorage().url('products/photo.png'),
                         f'https://images.example.com{path}?token=HS256-{expected}&expires=4600')

    @patch.dict('os.environ', BUNNY_ENV)
    def test_private_files_never_get_cdn_url(self):
        private = BunnyPrivateStorage()
        with self.assertRaises(ValueError):
            private.url('private-records/1/document.pdf')
        with self.assertRaises(ValueError):
            BunnyImageStorage().url('private-records/1/document.pdf')
        with self.assertRaises(ValueError):
            private._api_url('private-records/../products/photo.png')

    @patch.dict('os.environ', BUNNY_ENV)
    @patch('beparlyBackend.bunny_storage.requests.put')
    def test_upload_uses_authenticated_storage_api(self, put):
        put.return_value = Mock(status_code=201)
        saved = BunnyPrivateStorage()._save('private-records/1/document.pdf', ContentFile(b'pdf-data'))
        self.assertEqual(saved, 'private-records/1/document.pdf')
        self.assertEqual(put.call_args.args[0],
                         'https://storage.bunnycdn.com/example-zone/private-records/1/document.pdf')
        self.assertEqual(put.call_args.kwargs['headers']['AccessKey'], 'storage-secret')
        self.assertEqual(put.call_args.kwargs['headers']['Content-Type'], 'application/pdf')

    @override_settings(STORAGES={'default': {'BACKEND': 'beparlyBackend.bunny_storage.BunnyImageStorage'}})
    @patch('sales.image_snapshots.default_storage.url', return_value='https://images.example.com/signed')
    def test_snapshot_stores_key_and_signs_when_read(self, signed_url):
        self.assertEqual(snapshot_value('products/photo.png'), 'products/photo.png')
        self.assertEqual(snapshot_url('products/photo.png'), 'https://images.example.com/signed')
        signed_url.assert_called_once_with('products/photo.png')

    @patch('products.views.default_storage.delete')
    @patch('sales.models.QuotationLine.objects.filter')
    def test_replacing_image_preserves_quoted_file(self, quoted, delete):
        quoted.return_value.exists.return_value = True
        delete_unreferenced_image('products/quoted.png')
        delete.assert_not_called()

    @override_settings(API_ALLOWED_ORIGINS={'https://app.example.com'})
    def test_api_preflight_allows_only_configured_vercel_origin(self):
        client = Client()
        allowed = client.options('/api/v1/auth/login/', HTTP_ORIGIN='https://app.example.com')
        self.assertEqual(allowed.status_code, 204)
        self.assertEqual(allowed['Access-Control-Allow-Origin'], 'https://app.example.com')
        denied = client.options('/api/v1/auth/login/', HTTP_ORIGIN='https://other.example.com')
        self.assertNotIn('Access-Control-Allow-Origin', denied)
