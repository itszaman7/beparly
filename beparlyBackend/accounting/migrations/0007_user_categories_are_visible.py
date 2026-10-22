from django.db import migrations


def mark_user_categories_visible(apps, schema_editor):
    ExpenseCategory = apps.get_model('accounting', 'ExpenseCategory')
    IncomeCategory = apps.get_model('accounting', 'IncomeCategory')
    LedgerAccount = apps.get_model('accounting', 'LedgerAccount')
    account_ids = list(ExpenseCategory.objects.values_list('ledger_account_id', flat=True))
    account_ids += list(IncomeCategory.objects.values_list('ledger_account_id', flat=True))
    LedgerAccount.objects.filter(pk__in=account_ids).update(system_managed=False)


class Migration(migrations.Migration):
    dependencies = [('accounting', '0006_contact_customer_type')]

    operations = [migrations.RunPython(mark_user_categories_visible, migrations.RunPython.noop)]
