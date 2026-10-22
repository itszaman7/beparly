from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('sales', '0002_sale_checkout_details')]
    operations = [
        migrations.AddField(model_name='sale', name='customer_name_snapshot', field=models.CharField(blank=True, max_length=160)),
        migrations.AddField(model_name='sale', name='customer_phone_snapshot', field=models.CharField(blank=True, max_length=20)),
        migrations.AddField(model_name='sale', name='customer_address_snapshot', field=models.JSONField(blank=True, default=dict)),
    ]
