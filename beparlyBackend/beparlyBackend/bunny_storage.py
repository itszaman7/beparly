"""Django storage backed by Bunny's authenticated HTTP Storage API."""

import base64
import hashlib
import hmac
import mimetypes
import os
import posixpath
import time
from urllib.parse import quote

import requests
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible


PRIVATE_PREFIX = 'private-records/'


def _key(name):
    name = str(name).replace('\\', '/')
    normalized = posixpath.normpath(name).lstrip('/')
    if not name or normalized in ('', '.') or any(part in ('.', '..') for part in name.split('/')):
        raise ValueError('Invalid storage key.')
    return normalized


@deconstructible
class BunnyStorage(Storage):
    def __init__(self, private=False):
        self.private = private

    def _checked_key(self, name):
        key = _key(name)
        if key.startswith(PRIVATE_PREFIX) != self.private:
            raise ValueError('Storage key belongs to the wrong access class.')
        return key

    def _api_url(self, name):
        host = os.environ['BUNNY_STORAGE_HOST'].strip().rstrip('/')
        if not host.startswith('https://'):
            host = 'https://' + host
        zone = quote(os.environ['BUNNY_STORAGE_ZONE'], safe='')
        return f'{host}/{zone}/{quote(self._checked_key(name), safe="/")}'

    @staticmethod
    def _headers():
        return {'AccessKey': os.environ['BUNNY_STORAGE_PASSWORD']}

    def _save(self, name, content):
        key = self._checked_key(name)
        content.seek(0)
        response = requests.put(self._api_url(key), data=content,
                                headers={**self._headers(), 'Content-Type': mimetypes.guess_type(key)[0] or 'application/octet-stream'},
                                timeout=(10, 60))
        response.raise_for_status()
        return key

    def _open(self, name, mode='rb'):
        if mode not in ('r', 'rb'):
            raise ValueError('Bunny storage is read only when opening files.')
        response = requests.get(self._api_url(name), headers=self._headers(), timeout=(10, 60))
        if response.status_code == 404:
            raise FileNotFoundError(name)
        response.raise_for_status()
        return ContentFile(response.content, name=name)

    def delete(self, name):
        if not name:
            return
        response = requests.delete(self._api_url(name), headers=self._headers(), timeout=(10, 30))
        if response.status_code != 404:
            response.raise_for_status()

    def exists(self, name):
        with requests.get(self._api_url(name), headers=self._headers(),
                          stream=True, timeout=(10, 30)) as response:
            if response.status_code == 404:
                return False
            response.raise_for_status()
            return True

    def url(self, name):
        if self.private:
            raise ValueError('Private attachments have no public URL.')
        path = '/' + quote(self._checked_key(name), safe='/')
        expires = int(time.time()) + int(os.environ.get('BUNNY_CDN_URL_TTL', '3600'))
        key = os.environ['BUNNY_CDN_TOKEN_KEY'].encode('utf-8')
        digest = hmac.new(key, f'{path}{expires}'.encode('utf-8'), hashlib.sha256).digest()
        token = 'HS256-' + base64.urlsafe_b64encode(digest).rstrip(b'=').decode('ascii')
        return f'{os.environ["BUNNY_CDN_BASE_URL"].rstrip("/")}{path}?token={token}&expires={expires}'


@deconstructible
class BunnyImageStorage(BunnyStorage):
    def __init__(self):
        super().__init__(private=False)


@deconstructible
class BunnyPrivateStorage(BunnyStorage):
    def __init__(self):
        super().__init__(private=True)
