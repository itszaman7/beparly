from io import BytesIO

from django.core.files.storage import default_storage
from PIL import Image, UnidentifiedImageError

from .models import MediaAsset


def register_image(business_id, key, name='', size=0, user=None, command_id=None):
    return MediaAsset.objects.get_or_create(key=key, defaults={
        'business_id': business_id, 'name': (name or key.rsplit('/', 1)[-1])[:255],
        'size': size, 'uploaded_by': user, 'upload_command_id': command_id,
    })[0]


def delete_if_untracked(key):
    if not key or MediaAsset.objects.filter(key=key).exists():
        return
    from products.views import delete_unreferenced_image
    delete_unreferenced_image(key)


def normalized_image(upload):
    if not upload or upload.size > 5 * 1024 * 1024:
        raise ValueError('Choose an image smaller than 5 MB.')
    try:
        image = Image.open(upload)
        image.verify()
        upload.seek(0)
        image = Image.open(upload)
        if image.format not in ('JPEG', 'PNG', 'WEBP') or image.width * image.height > 25_000_000:
            raise ValueError('Choose a JPG, PNG or WebP image.')
        image.thumbnail((800, 800))
        image = image.convert('RGB')
        output = BytesIO()
        image.save(output, format='WEBP', quality=82)
        return output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError('The selected file is not a valid image.') from exc


def asset_data(asset, include_links=False):
    data = {'id': str(asset.pk), 'name': asset.name, 'size': asset.size,
            'created_at': asset.created_at.isoformat(), 'image_url': default_storage.url(asset.key)}
    if include_links:
        from accounts.models import Business
        from accounting.models import Contact
        from products.models import Product
        data['used_by'] = {
            'products': list(Product.objects.filter(business_id=asset.business_id, image_key=asset.key).values('id', 'name')),
            'suppliers': list(Contact.objects.filter(business_id=asset.business_id, image_key=asset.key, is_supplier=True).values('id', 'name')),
            'business_logo': Business.objects.filter(pk=asset.business_id, logo=asset.key).exists(),
        }
        for kind in ('products', 'suppliers'):
            data['used_by'][kind] = [{'id': str(row['id']), 'name': row['name']} for row in data['used_by'][kind]]
    return data
