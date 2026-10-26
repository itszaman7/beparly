import uuid
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from accounts.models import Business, BusinessMember, User
from accounting.models import Contact, JournalEntry, JournalLine, MoneyAccount, MoneyTransaction
from accounting.reconciliation import reconcile_business
from accounting.sale_reports import previews
from accounting.services import money_operation, reverse, setup_business
from products.models import Product
from stockkeeper.models import CostLayer, StockBalance, StockLocation, StockMovement
from stockkeeper.services import StockError, manual_receive, post_adjustment, receive


class ReconciliationTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        self.business = Business.objects.create(name='Reconciliation Test')
        BusinessMember.objects.create(user=self.owner, business=self.business, role=BusinessMember.OWNER)
        setup_business(self.business)

    def test_valid_owner_cash_and_opening_inventory_reconcile(self):
        cash = MoneyAccount.objects.get(business=self.business, is_default=True)
        money_operation(self.business, self.owner, uuid.uuid4(), 'owner_contribution', '25.00', cash)
        product = Product.objects.create(business=self.business, name='Pen', sku='PEN-R')
        location = StockLocation.objects.get(business=self.business, is_default=True)
        receive(product, location, Decimal('3'), Decimal('2.50'), self.owner, uuid.uuid4())
        self.assertEqual(reconcile_business(self.business), [])

    def test_detects_ledger_and_stock_discrepancies_without_repair(self):
        cash = MoneyAccount.objects.get(business=self.business, is_default=True)
        txn = money_operation(self.business, self.owner, uuid.uuid4(), 'owner_contribution', '25.00', cash)
        JournalLine.objects.filter(entry=txn.journal, account=cash.ledger_account).update(debit=Decimal('20'))
        product = Product.objects.create(business=self.business, name='Pen', sku='PEN-R')
        location = StockLocation.objects.get(business=self.business, is_default=True)
        receive(product, location, Decimal('3'), Decimal('2.50'), self.owner, uuid.uuid4())
        balance = StockBalance.objects.get(product=product, location=location)
        StockBalance.objects.filter(pk=balance.pk).update(quantity=Decimal('4'))
        findings = reconcile_business(self.business)
        self.assertTrue({'journal_integrity', 'money_accounts', 'inventory'} <=
                        {finding['category'] for finding in findings})
        self.assertEqual(StockBalance.objects.get(pk=balance.pk).quantity, Decimal('4'))
        self.assertEqual(JournalLine.objects.get(entry=txn.journal,
            account=cash.ledger_account).debit, Decimal('20'))

    def test_manual_adjustment_requires_explicit_financial_reason(self):
        product = Product.objects.create(business=self.business, name='Pen', sku='PEN-R')
        location = StockLocation.objects.get(business=self.business, is_default=True)
        with self.assertRaises(StockError):
            post_adjustment(product, location, Decimal('1'), True, self.owner,
                uuid.uuid4(), 'Count', unit_cost=Decimal('2.50'))
        with self.assertRaises(StockError):
            manual_receive(product, location, Decimal('1'), Decimal('2.50'),
                self.owner, uuid.uuid4(), 'Count')
        self.assertFalse(StockMovement.objects.filter(product=product).exists())

    def test_customer_advance_and_reversal_reconcile(self):
        cash = MoneyAccount.objects.get(business=self.business, is_default=True)
        customer = Contact.objects.create(business=self.business, name='Buyer',
            phone='01712345679', is_customer=True)
        txn = money_operation(self.business, self.owner, uuid.uuid4(),
            'customer_advance', '12.00', cash, contact=customer)
        self.assertEqual(reconcile_business(self.business), [])
        reversal = reverse(txn.journal, self.owner, uuid.uuid4(), 'Correction')
        MoneyTransaction.objects.create(business=self.business, kind='customer_advance_reversal',
            amount=txn.amount, account=cash, contact=customer, event_date=txn.event_date,
            journal=reversal)
        self.assertEqual(reconcile_business(self.business), [])

    def test_explicit_owner_stock_contribution_posts_once_to_capital(self):
        product = Product.objects.create(business=self.business, name='Pen', sku='PEN-R')
        location = StockLocation.objects.get(business=self.business, is_default=True)
        command = uuid.uuid4()
        first = manual_receive(product, location, Decimal('2'), Decimal('3.50'),
            self.owner, command, 'Owner supplied goods', financial_reason='owner_contribution')
        second = manual_receive(product, location, Decimal('2'), Decimal('3.50'),
            self.owner, command, 'Owner supplied goods', financial_reason='owner_contribution')
        self.assertEqual(first, second)
        self.assertEqual(StockBalance.objects.get(product=product, location=location).quantity, 2)
        journal = JournalEntry.objects.get(business=self.business,
            source_type='stock_movement', source_id=first['movement_id'])
        self.assertEqual(JournalLine.objects.get(entry=journal, account__code='INVENTORY').debit, 7)
        self.assertEqual(JournalLine.objects.get(entry=journal, account__code='CAPITAL').credit, 7)
        self.assertFalse(JournalLine.objects.filter(entry=journal, account__code='INVENTORY_GAIN').exists())
        self.assertEqual(reconcile_business(self.business), [])

    def test_sale_preview_ignores_legacy_non_uuid_source(self):
        self.assertEqual(previews(self.business, ['paged-0', '', None]), {})

    def test_posted_fifo_unit_cost_cannot_be_changed_by_model_save(self):
        product = Product.objects.create(business=self.business, name='Pen', sku='PEN-R')
        location = StockLocation.objects.get(business=self.business, is_default=True)
        receive(product, location, Decimal('3'), Decimal('2.50'), self.owner, uuid.uuid4())
        layer = CostLayer.objects.get(product=product)
        layer.unit_cost = Decimal('4.00')
        with self.assertRaises(ValidationError):
            layer.save(update_fields=['unit_cost'])
        layer.refresh_from_db()
        self.assertEqual(layer.unit_cost, Decimal('2.50'))
