from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounting', '0005_contact_customer_fields')]
    operations = [migrations.AddField(model_name='contact', name='customer_type', field=models.CharField(choices=[('regular', 'Regular customer'), ('wholesale', 'Wholesale customer')], default='regular', max_length=12))]
