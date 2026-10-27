from django.db import migrations


def backfill(apps, schema_editor):
    Asset = apps.get_model('media_library', 'MediaAsset')
    Product = apps.get_model('products', 'Product')
    Contact = apps.get_model('accounting', 'Contact')
    Business = apps.get_model('accounts', 'Business')
    for business_id, key in Product.objects.exclude(image_key='').values_list('business_id', 'image_key').iterator():
        Asset.objects.get_or_create(key=key, defaults={'business_id': business_id, 'name': key.rsplit('/', 1)[-1]})
    for business_id, key in Contact.objects.exclude(image_key='').values_list('business_id', 'image_key').iterator():
        Asset.objects.get_or_create(key=key, defaults={'business_id': business_id, 'name': key.rsplit('/', 1)[-1]})
    for business_id, key in Business.objects.exclude(logo='').exclude(logo__isnull=True).values_list('id', 'logo').iterator():
        Asset.objects.get_or_create(key=key, defaults={'business_id': business_id, 'name': key.rsplit('/', 1)[-1]})


class Migration(migrations.Migration):
    dependencies = [('media_library', '0001_initial'), ('products', '0006_remove_productunit_unique_package_name_per_product_and_more'),
                    ('accounting', '0013_recordattachment')]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
