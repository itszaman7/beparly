from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0005_business_expiry_warning_days_business_timezone')]
    operations = [
        migrations.AddField(model_name='business', name='phone', field=models.CharField(blank=True, max_length=20)),
        migrations.AddField(model_name='business', name='address', field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name='business', name='logo', field=models.ImageField(blank=True, null=True, upload_to='business_logos/')),
    ]
