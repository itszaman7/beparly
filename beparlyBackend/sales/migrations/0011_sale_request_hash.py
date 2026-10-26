from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('sales', '0010_salereturnreceipt_cost_layers_and_more')]

    operations = [
        migrations.AddField(
            model_name='sale', name='request_hash',
            field=models.CharField(blank=True, max_length=64),
        ),
    ]
