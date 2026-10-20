from django.db import migrations


def create_defaults(apps, schema_editor):
    Business = apps.get_model('accounts', 'Business')
    StockLocation = apps.get_model('stockkeeper', 'StockLocation')
    database = schema_editor.connection.alias
    for business in Business.objects.using(database).iterator():
        StockLocation.objects.using(database).get_or_create(
            business_id=business.pk,
            is_default=True,
            defaults={'name': 'Main Shop', 'type': 'shop', 'is_active': True},
        )


class Migration(migrations.Migration):
    dependencies = [
        ('stockkeeper', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(create_defaults, migrations.RunPython.noop),
    ]
