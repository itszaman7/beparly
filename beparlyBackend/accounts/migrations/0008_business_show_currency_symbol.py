from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0007_businessmember_can_manage_purchases')]
    operations = [
        migrations.AddField(
            model_name='business',
            name='show_currency_symbol',
            field=models.BooleanField(default=True),
        ),
    ]
