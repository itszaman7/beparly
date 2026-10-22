import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounting', '0004_financial_categories')]
    operations = [
        migrations.AddField(model_name='contact', name='address', field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name='contact', name='area', field=models.CharField(blank=True, max_length=100)),
        migrations.AddField(model_name='contact', name='district', field=models.CharField(blank=True, max_length=80)),
        migrations.AddField(model_name='contact', name='notes', field=models.TextField(blank=True)),
        migrations.AddField(model_name='contact', name='created_by', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='created_contacts', to='accounts.user')),
        migrations.AlterField(model_name='contact', name='name', field=models.CharField(blank=True, max_length=160)),
        migrations.AlterField(model_name='contact', name='phone', field=models.CharField(blank=True, max_length=20)),
        migrations.AddConstraint(model_name='contact', constraint=models.UniqueConstraint(condition=models.Q(('is_customer', True)) & ~models.Q(('phone', '')), fields=('business', 'phone'), name='unique_customer_phone_per_business')),
    ]
