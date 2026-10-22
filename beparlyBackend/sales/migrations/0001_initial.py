import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ('accounts', '0005_business_expiry_warning_days_business_timezone'),
        ('accounting', '0004_financial_categories'),
        ('products', '0006_remove_productunit_unique_package_name_per_product_and_more'),
        ('stockkeeper', '0009_stockmovement_opening_movement'),
    ]
    operations = [
        migrations.CreateModel(name='SaleSequence', fields=[
            ('business', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, primary_key=True, serialize=False, to='accounts.business')),
            ('value', models.PositiveBigIntegerField(default=0)),
        ]),
        migrations.CreateModel(name='Sale', fields=[
            ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ('invoice_number', models.CharField(max_length=40)),
            ('command_id', models.UUIDField()),
            ('mode', models.CharField(choices=[('quick', 'Quick sale'), ('manual', 'Manual sale')], max_length=12)),
            ('price_tier', models.CharField(choices=[('retail', 'Retail'), ('wholesale', 'Wholesale')], max_length=12)),
            ('status', models.CharField(default='completed', max_length=12)),
            ('cancellation_reason', models.CharField(blank=True, max_length=240)),
            ('cancellation_command_id', models.UUIDField(blank=True, null=True)),
            ('payment_status', models.CharField(default='paid', max_length=12)),
            ('subtotal', models.DecimalField(decimal_places=2, max_digits=18)),
            ('discount', models.DecimalField(decimal_places=2, default=0, max_digits=18)),
            ('total', models.DecimalField(decimal_places=2, max_digits=18)),
            ('paid', models.DecimalField(decimal_places=2, default=0, max_digits=18)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('actor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='accounts.user')),
            ('business', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='sales', to='accounts.business')),
            ('customer', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to='accounting.contact')),
            ('income_category', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='accounting.incomecategory')),
            ('location', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='stockkeeper.stocklocation')),
        ]),
        migrations.CreateModel(name='SaleLine', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('product_name', models.CharField(max_length=180)), ('variant_name', models.CharField(blank=True, max_length=180)),
            ('sku', models.CharField(max_length=64)), ('unit_name', models.CharField(max_length=40)),
            ('conversion_factor', models.DecimalField(decimal_places=3, max_digits=18)),
            ('quantity', models.DecimalField(decimal_places=3, max_digits=18)),
            ('base_quantity', models.DecimalField(decimal_places=3, max_digits=18)),
            ('unit_price', models.DecimalField(decimal_places=2, max_digits=14)),
            ('line_total', models.DecimalField(decimal_places=2, max_digits=18)),
            ('inventory_cost', models.DecimalField(decimal_places=7, max_digits=22)),
            ('cost_layers', models.JSONField(default=list)),
            ('batch', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to='products.stockbatch')),
            ('product', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='products.product')),
            ('sale', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='lines', to='sales.sale')),
            ('variant', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='products.productvariant')),
        ]),
        migrations.CreateModel(name='SalePayment', fields=[
            ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ('command_id', models.UUIDField()), ('amount', models.DecimalField(decimal_places=2, max_digits=18)),
            ('kind', models.CharField(default='receipt', max_length=12)), ('created_at', models.DateTimeField(auto_now_add=True)),
            ('account', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='accounting.moneyaccount')),
            ('actor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='accounts.user')),
            ('journal', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, to='accounting.journalentry')),
            ('sale', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='payments', to='sales.sale')),
        ]),
        migrations.AddConstraint(model_name='sale', constraint=models.UniqueConstraint(fields=('business', 'command_id'), name='unique_sale_command')),
        migrations.AddConstraint(model_name='sale', constraint=models.UniqueConstraint(fields=('business', 'invoice_number'), name='unique_sale_invoice')),
        migrations.AddConstraint(model_name='sale', constraint=models.UniqueConstraint(condition=models.Q(('cancellation_command_id__isnull', False)), fields=('business', 'cancellation_command_id'), name='unique_sale_cancellation_command')),
        migrations.AddConstraint(model_name='sale', constraint=models.CheckConstraint(condition=models.Q(('subtotal__gte', 0)) & models.Q(('discount__gte', 0)) & models.Q(('total__gte', 0)) & models.Q(('paid__gte', 0)), name='sale_amounts_nonnegative')),
        migrations.AddConstraint(model_name='salepayment', constraint=models.UniqueConstraint(fields=('sale', 'command_id'), name='unique_sale_payment_command')),
    ]
