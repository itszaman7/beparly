import django.db.models.deletion
from django.db import migrations, models


def give_existing_expense_categories_accounts(apps, schema_editor):
    ExpenseCategory = apps.get_model('accounting', 'ExpenseCategory')
    LedgerAccount = apps.get_model('accounting', 'LedgerAccount')
    for category in ExpenseCategory.objects.select_related('ledger_account').all().iterator():
        account = category.ledger_account
        if account.business_id != category.business_id or account.type != 'expense':
            continue
        new_account = LedgerAccount.objects.create(
            business_id=category.business_id,
            code=f'EXPENSE-CAT-{category.pk}',
            name=category.name,
            type='expense',
            system_managed=True,
        )
        ExpenseCategory.objects.filter(pk=category.pk).update(ledger_account_id=new_account.pk)


class Migration(migrations.Migration):
    dependencies = [('accounting', '0003_moneyaccount_create_command_id_and_more')]

    operations = [
        migrations.CreateModel(
            name='IncomeCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('business', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='accounts.business')),
                ('ledger_account', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='accounting.ledgeraccount')),
            ],
        ),
        migrations.RunPython(give_existing_expense_categories_accounts, migrations.RunPython.noop),
        migrations.AddField(
            model_name='moneytransaction', name='income_category',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to='accounting.incomecategory'),
        ),
        migrations.AddConstraint(
            model_name='incomecategory',
            constraint=models.UniqueConstraint(fields=('business', 'name'), name='unique_income_category'),
        ),
    ]
