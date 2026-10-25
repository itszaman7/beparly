from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0008_business_show_currency_symbol')]
    operations = [
        migrations.AddField(
            model_name='business',
            name='invoice_footer_text',
            field=models.CharField(max_length=500, default='Thank you for your business.', blank=True),
        ),
    ]
