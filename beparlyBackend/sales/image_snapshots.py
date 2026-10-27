"""Persist storage keys in production so short-lived CDN signatures stay fresh."""

from django.conf import settings
from django.core.files.storage import default_storage


def snapshot_value(image_key):
    if not image_key:
        return ''
    if settings.STORAGES['default']['BACKEND'] == 'beparlyBackend.bunny_storage.BunnyImageStorage':
        return image_key
    return default_storage.url(image_key)


def snapshot_url(value):
    if not value:
        return ''
    if value.startswith(('http://', 'https://', '/')):
        return value
    return default_storage.url(value)
