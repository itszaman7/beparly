import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('sales', '0004_saleline_image_url_snapshot'), ('accounting', '0010_party_ledger_accounts')]

    operations = [
        migrations.AddField(model_name='sale', name='delivery_fee', field=models.DecimalField(decimal_places=2, default=0, max_digits=18)),
        migrations.RemoveConstraint(model_name='sale', name='sale_amounts_nonnegative'),
        migrations.AddConstraint(model_name='sale', constraint=models.CheckConstraint(
            condition=models.Q(subtotal__gte=0) & models.Q(discount__gte=0) & models.Q(delivery_fee__gte=0) & models.Q(total__gte=0) & models.Q(paid__gte=0),
            name='sale_amounts_nonnegative')),
        migrations.CreateModel(name='SaleReturn', fields=[
            ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ('command_id', models.UUIDField()),
            ('reason', models.CharField(max_length=240)),
            ('amount', models.DecimalField(decimal_places=2, max_digits=18)),
            ('due_reduction', models.DecimalField(decimal_places=2, max_digits=18)),
            ('refund_amount', models.DecimalField(decimal_places=2, max_digits=18)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('actor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='accounts.user')),
            ('journal', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, to='accounting.journalentry')),
            ('refund_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to='accounting.moneyaccount')),
            ('refund_journal', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='accounting.journalentry')),
            ('sale', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='returns', to='sales.sale')),
        ], options={'constraints': [
            models.UniqueConstraint(fields=('sale', 'command_id'), name='unique_sale_return_command'),
            models.CheckConstraint(condition=models.Q(amount__gt=0) & models.Q(due_reduction__gte=0) & models.Q(refund_amount__gte=0), name='sale_return_amounts_valid'),
        ]}),
        migrations.CreateModel(name='SaleReturnLine', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('quantity', models.DecimalField(decimal_places=3, max_digits=18)),
            ('amount', models.DecimalField(decimal_places=2, max_digits=18)),
            ('inventory_cost', models.DecimalField(decimal_places=7, max_digits=22)),
            ('condition', models.CharField(choices=[('sellable', 'Sellable'), ('damaged', 'Damaged')], max_length=12)),
            ('sale_line', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='return_lines', to='sales.saleline')),
            ('sale_return', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='lines', to='sales.salereturn')),
        ], options={'constraints': [
            models.UniqueConstraint(fields=('sale_return', 'sale_line'), name='unique_sale_return_line'),
            models.CheckConstraint(condition=models.Q(quantity__gt=0) & models.Q(amount__gt=0) & models.Q(inventory_cost__gte=0), name='sale_return_line_amounts_valid'),
        ]}),
    ]
