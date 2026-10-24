import uuid
from decimal import Decimal

from django.db import migrations, models
import django.db.models.deletion


def backfill_party_ledgers(apps, schema_editor):
    Contact = apps.get_model('accounting', 'Contact')
    Ledger = apps.get_model('accounting', 'LedgerAccount')
    Entry = apps.get_model('accounting', 'JournalEntry')
    Line = apps.get_model('accounting', 'JournalLine')
    for contact in Contact.objects.all().iterator():
        lines = []
        if contact.is_customer:
            account = Ledger.objects.create(business_id=contact.business_id,
                code=f'AR-{contact.pk.hex[:32]}', name=f'Accounts Receivable — {contact.name}',
                type='asset', system_managed=True)
            Contact.objects.filter(pk=contact.pk).update(receivable_account_id=account.pk)
            totals = Line.objects.filter(contact_id=contact.pk, account__business_id=contact.business_id,
                account__code='AR').aggregate(d=models.Sum('debit'), c=models.Sum('credit'))
            value = (totals['d'] or Decimal('0')) - (totals['c'] or Decimal('0'))
            if value > 0:
                lines.extend([(account, value, Decimal('0')), (Ledger.objects.get(business_id=contact.business_id, code='AR'), Decimal('0'), value)])
            elif value < 0:
                lines.extend([(Ledger.objects.get(business_id=contact.business_id, code='AR'), -value, Decimal('0')), (account, Decimal('0'), -value)])
        if contact.is_supplier:
            account = Ledger.objects.create(business_id=contact.business_id,
                code=f'AP-{contact.pk.hex[:32]}', name=f'Accounts Payable — {contact.name}',
                type='liability', system_managed=True)
            Contact.objects.filter(pk=contact.pk).update(payable_account_id=account.pk)
            totals = Line.objects.filter(contact_id=contact.pk, account__business_id=contact.business_id,
                account__code='AP').aggregate(d=models.Sum('debit'), c=models.Sum('credit'))
            value = (totals['c'] or Decimal('0')) - (totals['d'] or Decimal('0'))
            if value > 0:
                lines.extend([(account, Decimal('0'), value), (Ledger.objects.get(business_id=contact.business_id, code='AP'), value, Decimal('0'))])
            elif value < 0:
                lines.extend([(Ledger.objects.get(business_id=contact.business_id, code='AP'), Decimal('0'), -value), (account, -value, Decimal('0'))])
        if lines:
            entry = Entry.objects.create(business_id=contact.business_id, posting_date=contact.created_at.date(),
                event_date=contact.created_at.date(), description=f'Opening party ledger: {contact.name}',
                source_type='party_ledger_migration', source_id=str(contact.pk))
            for account, debit, credit in lines:
                Line.objects.create(entry_id=entry.pk, account_id=account.pk, contact_id=contact.pk, debit=debit, credit=credit)


class Migration(migrations.Migration):
    dependencies = [('accounting', '0009_contact_image_key')]
    operations = [
        migrations.AddField(model_name='contact', name='receivable_account', field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='receivable_contact', to='accounting.ledgeraccount')),
        migrations.AddField(model_name='contact', name='payable_account', field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='payable_contact', to='accounting.ledgeraccount')),
        migrations.RunPython(backfill_party_ledgers, migrations.RunPython.noop),
    ]
