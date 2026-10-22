from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):
    dependencies = [('sales', '0001_initial')]

    operations = [
        migrations.AddField(model_name='sale', name='billing_address', field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name='sale', name='delivery_address', field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name='sale', name='source', field=models.CharField(blank=True, max_length=80)),
        migrations.AddField(model_name='sale', name='notes', field=models.TextField(blank=True)),
        migrations.AddField(model_name='sale', name='invoice_date', field=models.DateField(default=timezone.localdate)),
    ]
