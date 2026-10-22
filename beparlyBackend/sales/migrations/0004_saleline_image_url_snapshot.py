from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('sales', '0003_sale_customer_snapshots')]

    operations = [
        migrations.AddField(
            model_name='saleline',
            name='image_url_snapshot',
            field=models.CharField(blank=True, max_length=500),
        ),
    ]
