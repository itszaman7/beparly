from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0009_business_invoice_footer_text')]

    operations = [
        migrations.AddField(
            model_name='business', name='label_print_settings',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
