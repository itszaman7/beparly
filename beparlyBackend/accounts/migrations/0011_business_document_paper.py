from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0010_business_label_print_settings')]

    operations = [
        migrations.AddField(model_name='business', name='invoice_paper', field=models.CharField(default='A4', max_length=2)),
        migrations.AddField(model_name='business', name='receipt_paper', field=models.CharField(default='80mm', max_length=4)),
    ]
