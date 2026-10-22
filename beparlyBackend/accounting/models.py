import uuid
import re

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


class LedgerAccount(models.Model):
    TYPES = [('asset', 'Asset'), ('liability', 'Liability'), ('equity', 'Equity'),
             ('income', 'Income'), ('expense', 'Expense')]
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120)
    type = models.CharField(max_length=12, choices=TYPES)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT)
    system_managed = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'code'], name='unique_ledger_code')]

    def clean(self):
        if self.parent_id:
            if self.parent.business_id != self.business_id or self.parent.type != self.type:
                raise ValidationError('Parent account must have the same business and type.')
            cursor = self.parent
            while cursor:
                if cursor.pk == self.pk:
                    raise ValidationError('Account hierarchy cannot contain a cycle.')
                cursor = cursor.parent

    def save(self, *args, **kwargs):
        self.clean()
        if self.pk and LedgerAccount.objects.filter(pk=self.pk, journalline__isnull=False).exists():
            old = LedgerAccount.objects.get(pk=self.pk)
            if (old.business_id, old.code, old.type) != (self.business_id, self.code, self.type):
                raise ValidationError('A posted account cannot change business, code or type.')
        super().save(*args, **kwargs)


class Contact(models.Model):
    REGULAR = 'regular'
    WHOLESALE = 'wholesale'
    CUSTOMER_TYPE_CHOICES = [(REGULAR, 'Regular customer'), (WHOLESALE, 'Wholesale customer')]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    name = models.CharField(max_length=160, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    address = models.CharField(max_length=255, blank=True)
    district = models.CharField(max_length=80, blank=True)
    area = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey('accounts.User', null=True, blank=True, on_delete=models.PROTECT, related_name='created_contacts')
    is_customer = models.BooleanField(default=False)
    customer_type = models.CharField(max_length=12, choices=CUSTOMER_TYPE_CHOICES, default=REGULAR)
    is_supplier = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'phone'], condition=Q(is_customer=True) & ~Q(phone=''), name='unique_customer_phone_per_business')]

    def clean(self):
        if not self.is_customer and not self.is_supplier:
            raise ValidationError('Choose customer, supplier, or both.')
        if self.is_customer and self.name != 'Walk-in Customer':
            if not self.phone:
                raise ValidationError({'phone': 'Customer phone number is required.'})
            self.phone = normalize_customer_phone(self.phone)


def normalize_customer_phone(value):
    digits = re.sub(r'[\s().-]', '', str(value or ''))
    if digits.startswith('+880'):
        digits = digits[1:]
    if digits.startswith('880'):
        digits = '0' + digits[3:]
    if not re.fullmatch(r'01[3-9]\d{8}', digits):
        raise ValidationError({'phone': 'Enter a valid Bangladeshi mobile number.'})
    return '+880' + digits[1:]

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)


class JournalEntry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    posting_date = models.DateField()
    event_date = models.DateField()
    description = models.CharField(max_length=240)
    source_type = models.CharField(max_length=40)
    source_id = models.CharField(max_length=80)
    command_id = models.UUIDField(null=True, blank=True)
    actor = models.ForeignKey('accounts.User', null=True, on_delete=models.PROTECT)
    reverses = models.OneToOneField('self', null=True, blank=True, on_delete=models.PROTECT, related_name='reversal')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['business', 'source_type', 'source_id'], name='unique_financial_source'),
            models.UniqueConstraint(fields=['business', 'command_id'], condition=Q(command_id__isnull=False), name='unique_financial_command'),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError('Posted journal entries are immutable.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Posted journal entries cannot be deleted.')


class JournalLine(models.Model):
    entry = models.ForeignKey(JournalEntry, on_delete=models.PROTECT, related_name='lines')
    account = models.ForeignKey(LedgerAccount, on_delete=models.PROTECT)
    contact = models.ForeignKey(Contact, null=True, blank=True, on_delete=models.PROTECT)
    debit = models.DecimalField(max_digits=22, decimal_places=7, default=0)
    credit = models.DecimalField(max_digits=22, decimal_places=7, default=0)

    class Meta:
        constraints = [models.CheckConstraint(
            condition=(Q(debit__gt=0, credit=0) | Q(credit__gt=0, debit=0)), name='journal_line_one_side')]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError('Posted journal lines are immutable.')
        if self.account.business_id != self.entry.business_id or (self.contact_id and self.contact.business_id != self.entry.business_id):
            raise ValidationError('Journal references must belong to the same business.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Posted journal lines cannot be deleted.')


class MoneyAccount(models.Model):
    KINDS = [('cash', 'Cash'), ('bank', 'Bank'), ('wallet', 'Mobile wallet'), ('other', 'Other')]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    ledger_account = models.OneToOneField(LedgerAccount, on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=12, choices=KINDS)
    masked_reference = models.CharField(max_length=40, blank=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    create_command_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['business'], condition=Q(is_default=True), name='one_default_money_account'),
            models.UniqueConstraint(fields=['business', 'create_command_id'], condition=Q(create_command_id__isnull=False), name='unique_money_account_command'),
        ]

    def save(self, *args, **kwargs):
        if self.ledger_account.business_id != self.business_id or self.ledger_account.type != 'asset':
            raise ValidationError('Money account must link to a business asset account.')
        super().save(*args, **kwargs)


class MoneyTransaction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    kind = models.CharField(max_length=32)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    account = models.ForeignKey(MoneyAccount, on_delete=models.PROTECT, related_name='transactions')
    destination = models.ForeignKey(MoneyAccount, null=True, blank=True, on_delete=models.PROTECT, related_name='incoming_transfers')
    contact = models.ForeignKey(Contact, null=True, blank=True, on_delete=models.PROTECT)
    income_category = models.ForeignKey('IncomeCategory', null=True, blank=True, on_delete=models.PROTECT)
    note = models.CharField(max_length=240, blank=True)
    event_date = models.DateField()
    journal = models.OneToOneField(JournalEntry, on_delete=models.PROTECT)
    reversed_by = models.OneToOneField('self', null=True, blank=True, on_delete=models.PROTECT, related_name='original_transaction')
    created_at = models.DateTimeField(auto_now_add=True)


class ExpenseCategory(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    ledger_account = models.ForeignKey(LedgerAccount, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'name'], name='unique_expense_category')]


class IncomeCategory(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    ledger_account = models.ForeignKey(LedgerAccount, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'name'], name='unique_income_category')]


class Expense(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT)
    money_transaction = models.OneToOneField(MoneyTransaction, on_delete=models.PROTECT)


class BusinessAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    name = models.CharField(max_length=160)
    cost = models.DecimalField(max_digits=18, decimal_places=2)
    residual_value = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    useful_life_months = models.PositiveIntegerField()
    in_service_date = models.DateField()
    purchase_journal = models.OneToOneField(JournalEntry, on_delete=models.PROTECT, related_name='+')
    sale_journal = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    sold_on = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class AssetDepreciation(models.Model):
    asset = models.ForeignKey(BusinessAsset, on_delete=models.PROTECT, related_name='depreciations')
    period = models.DateField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    journal = models.OneToOneField(JournalEntry, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['asset', 'period'], name='unique_asset_depreciation_period')]


class InventoryAccountingCutoff(models.Model):
    business = models.OneToOneField('accounts.Business', primary_key=True, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=22, decimal_places=3)
    value = models.DecimalField(max_digits=22, decimal_places=7)
    journal = models.OneToOneField(JournalEntry, null=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
