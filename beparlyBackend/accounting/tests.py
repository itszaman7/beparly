import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from unittest import skipUnless

from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase

from accounts.models import Business, BusinessMember, User
from products.models import Product, StockBatch
from stockkeeper.models import CostLayer, StockBalance, StockLocation, StockMovement
from stockkeeper.services import post_adjustment, post_transfer, post_waste, receive

from .models import BusinessAsset, Contact, ExpenseCategory, IncomeCategory, InventoryAccountingCutoff, JournalEntry, JournalLine, MoneyAccount, MoneyTransaction
from .services import (AccountingError, balance, contact_position, depreciate, dr,
                       create_money_account, ensure_inventory_cutoff, ledger, money_operation, post, purchase_asset,
                       create_financial_category, reverse, sell_asset, setup_business)
from .contracts import purchase_lines, sale_lines


class AccountingTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        self.business = Business.objects.create(name='Accounting Test')
        BusinessMember.objects.create(user=self.owner, business=self.business, role=BusinessMember.OWNER)
        setup_business(self.business)
        self.cash = MoneyAccount.objects.get(business=self.business, is_default=True)
        self.assertEqual(ExpenseCategory.objects.filter(business=self.business).count(), 0)

    def test_setup_and_balanced_idempotent_posting(self):
        setup_business(self.business)
        self.assertEqual(MoneyAccount.objects.filter(business=self.business).count(), 1)
        command = uuid.uuid4()
        txn = money_operation(self.business, self.owner, command, 'owner_contribution', '120.00', self.cash)
        self.assertEqual(balance(self.cash.ledger_account), Decimal('120'))
        self.assertEqual(money_operation(self.business, self.owner, command, 'owner_contribution', '120.00', self.cash).pk, txn.pk)
        self.assertEqual(JournalEntry.objects.filter(business=self.business, source_type='money').count(), 1)
        self.assertEqual(sum((line.debit for line in txn.journal.lines.all()), Decimal('0')),
                         sum((line.credit for line in txn.journal.lines.all()), Decimal('0')))

    def test_unbalanced_cross_business_and_immutable(self):
        other = Business.objects.create(name='Other')
        setup_business(other)
        with self.assertRaises(AccountingError):
            post(self.business, 'test', 'unbalanced', 'Bad', [dr(ledger(self.business, 'OPENING'), 1),
                (ledger(self.business, 'CAPITAL'), 0, 2, None)])
        with self.assertRaises(AccountingError):
            post(self.business, 'test', 'cross', 'Bad', [dr(ledger(other, 'OPENING'), 1),
                (ledger(self.business, 'CAPITAL'), 0, 1, None)])
        txn = money_operation(self.business, self.owner, uuid.uuid4(), 'owner_contribution', 1, self.cash)
        with self.assertRaises(ValueError):
            txn.journal.save()
        with self.assertRaises(ValueError):
            txn.journal.lines.first().delete()

    def test_reversal_preserves_original(self):
        txn = money_operation(self.business, self.owner, uuid.uuid4(), 'owner_contribution', 20, self.cash)
        reversal = reverse(txn.journal, self.owner, uuid.uuid4(), 'Correction')
        self.assertEqual(reversal.reverses_id, txn.journal_id)
        self.assertEqual(balance(self.cash.ledger_account), 0)
        with self.assertRaises(AccountingError):
            reverse(txn.journal, self.owner, uuid.uuid4(), 'Again')

    def test_contact_advances_and_transfer(self):
        customer = Contact.objects.create(business=self.business, name='Karim', is_customer=True)
        supplier = Contact.objects.create(business=self.business, name='Karim Supplier', is_supplier=True)
        money_operation(self.business, self.owner, uuid.uuid4(), 'customer_advance', 50, self.cash, contact=customer)
        money_operation(self.business, self.owner, uuid.uuid4(), 'supplier_advance', 30, self.cash, contact=supplier)
        self.assertEqual(Decimal(contact_position(customer)['customer_advance']), 50)
        self.assertEqual(Decimal(contact_position(supplier)['supplier_advance']), 30)
        self.assertEqual(balance(self.cash.ledger_account), 20)
        money_operation(self.business, self.owner, uuid.uuid4(), 'customer_advance_refund', 10, self.cash, contact=customer)
        self.assertEqual(Decimal(contact_position(customer)['customer_advance']), 40)
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'customer_advance_refund', 41, self.cash, contact=customer)
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'transfer', 1, self.cash, destination=self.cash)

    def test_money_account_opening_transfer_expense_and_negative_balance(self):
        command = uuid.uuid4()
        bank = create_money_account(self.business, 'Bank', 'bank', command_id=command)
        self.assertEqual(create_money_account(self.business, 'Bank', 'bank', command_id=command).pk, bank.pk)
        with self.assertRaises(AccountingError):
            create_money_account(self.business, 'Changed', 'bank', command_id=command)
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'opening_balance', 100, self.cash)
        money_operation(self.business, self.owner, uuid.uuid4(), 'opening_balance', 100, self.cash, allow_opening=True)
        money_operation(self.business, self.owner, uuid.uuid4(), 'transfer', 30, self.cash, destination=bank)
        category = create_financial_category(self.business, self.owner, 'Electricity', 'expense')
        money_operation(self.business, self.owner, uuid.uuid4(), 'expense', 40, bank, category=category)
        self.assertEqual(balance(self.cash.ledger_account), 70)
        self.assertEqual(balance(bank.ledger_account), -10)
        self.assertEqual(balance(category.ledger_account), 40)
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'opening_balance', 20, self.cash, allow_opening=True)

    def test_asset_depreciation_and_sale(self):
        asset = purchase_asset(self.business, self.owner, uuid.uuid4(), 'Table', 1200, 0, 12,
                               date(2025, 1, 10), self.cash)
        first = depreciate(asset, date(2025, 2, 1))
        self.assertEqual(first.amount, 100)
        self.assertEqual(depreciate(asset, date(2025, 2, 1)).pk, first.pk)
        sold = sell_asset(asset, self.owner, uuid.uuid4(), 1100, self.cash)
        self.assertEqual(sold.sale_journal.lines.count(), 4)
        self.assertEqual(balance(ledger(self.business, 'FIXED_ASSET')), 0)
        self.assertEqual(MoneyTransaction.objects.filter(business=self.business).count(), 2)

    def test_depreciation_rounding_finishes_at_residual(self):
        asset = purchase_asset(self.business, self.owner, uuid.uuid4(), 'Shelf', Decimal('1.50'),
            0, 100, date(2020, 1, 1), self.cash)
        for index in range(100):
            period = date(2020 + (index + 1) // 12, (index + 1) % 12 + 1, 1)
            depreciate(asset, period)
        self.assertEqual(sum((row.amount for row in asset.depreciations.all()), Decimal('0')), Decimal('1.50'))

    def test_future_sale_purchase_lines_balance_and_contact_tag(self):
        customer = Contact.objects.create(business=self.business, name='Buyer', is_customer=True)
        supplier = Contact.objects.create(business=self.business, name='Seller', is_supplier=True)
        income = create_financial_category(self.business, self.owner, 'Product sales', 'income')
        sale = sale_lines(self.business, customer, 70000, 30000, Decimal('60000'), self.cash, income)
        purchase = purchase_lines(self.business, supplier, 20000, 5000, self.cash)
        self.assertEqual(sum((item[1] for item in sale), 0), sum((item[2] for item in sale), 0))
        self.assertEqual(sum((item[1] for item in purchase), 0), sum((item[2] for item in purchase), 0))
        self.assertEqual(next(item[1] for item in sale if item[0].code == 'AR'), 40000)
        self.assertEqual(next(item[2] for item in sale if item[0].pk == income.ledger_account_id), 70000)
        self.assertEqual(next(item[2] for item in purchase if item[0].code == 'AP'), 15000)

    def test_categories_are_business_scoped_and_post_to_distinct_accounts(self):
        expense = create_financial_category(self.business, self.owner, 'Rent', 'expense')
        income = create_financial_category(self.business, self.owner, 'Commission', 'income')
        self.assertEqual(expense.ledger_account.type, 'expense')
        self.assertEqual(income.ledger_account.type, 'income')
        self.assertNotEqual(expense.ledger_account_id, ledger(self.business, 'OPERATING_EXPENSE').pk)
        with self.assertRaises(AccountingError):
            create_financial_category(self.business, self.owner, 'rent', 'expense')
        other = Business.objects.create(name='Category isolation')
        setup_business(other)
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'expense', 10, self.cash,
                            category=create_financial_category(other, None, 'Rent', 'expense'))
        expense_txn = money_operation(self.business, self.owner, uuid.uuid4(), 'expense', 10, self.cash, category=expense)
        income_txn = money_operation(self.business, self.owner, uuid.uuid4(), 'other_income', 15, self.cash, income_category=income)
        self.assertEqual(balance(expense.ledger_account), Decimal('10'))
        self.assertEqual(balance(income.ledger_account), Decimal('15'))
        self.assertEqual(income_txn.income_category_id, income.pk)
        self.assertEqual(sum((line.debit for line in income_txn.journal.lines.all()), Decimal('0')),
                         sum((line.credit for line in income_txn.journal.lines.all()), Decimal('0')))
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'other_income', 10, self.cash)

    def test_inventory_fifo_writeoff_and_expiry_without_automatic_loss(self):
        product = Product.objects.create(business=self.business, name='Milk', sku='MILK-A',
                                         tracking_mode='expiry')
        variant = product.variants.get(is_default=True)
        batch = StockBatch.objects.create(product=product, variant=variant, lot_code='EXP',
                                          expires_on=date.today() - timedelta(days=1))
        location = StockLocation.objects.get(business=self.business, is_default=True)
        receive(product, location, Decimal('2'), Decimal('3.25'), self.owner, uuid.uuid4(), batch=batch)
        receive(product, location, Decimal('2'), Decimal('5'), self.owner, uuid.uuid4(), batch=batch)
        self.assertEqual(balance(ledger(self.business, 'INVENTORY_LOSS')), 0)
        result = post_waste(product, location, Decimal('3'), self.owner, uuid.uuid4(), 'expired', batch=batch)
        self.assertEqual(Decimal(result['inventory_cost']), Decimal('11.50'))
        self.assertEqual(balance(ledger(self.business, 'INVENTORY_LOSS')), Decimal('11.50'))
        self.assertEqual(StockMovement.objects.filter(business=self.business, type='waste').count(), 1)
        self.assertEqual(InventoryAccountingCutoff.objects.get(business=self.business).value, 0)

    def test_owner_money_api_is_business_scoped(self):
        token = self.client.post('/api/v1/auth/login/', json.dumps({'phone': self.owner.phone,
            'password': 'OwnerPass#83'}), content_type='application/json').json()['token']
        path = f'/api/v1/businesses/{self.business.pk}/money/transactions/'
        result = self.client.post(path, json.dumps({'kind': 'owner_contribution', 'amount': '7.00',
            'account_id': str(self.cash.pk)}), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_COMMAND_ID=str(uuid.uuid4()))
        self.assertEqual(result.status_code, 201, result.content)
        opening = self.client.post(path, json.dumps({'kind': 'opening_balance', 'amount': '10.00',
            'account_id': str(self.cash.pk)}), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_COMMAND_ID=str(uuid.uuid4()))
        self.assertEqual(opening.status_code, 400, opening.content)
        other = Business.objects.create(name='Other')
        denied = self.client.get(f'/api/v1/businesses/{other.pk}/money/accounts/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(denied.status_code, 404)

    def test_historical_inventory_cutoff_keeps_rows_and_cost(self):
        product = Product.objects.create(business=self.business, name='Soap', sku='SOAP-CUTOFF')
        variant = product.variants.get(is_default=True)
        location = StockLocation.objects.get(business=self.business, is_default=True)
        stock = StockBalance.objects.create(business=self.business, product=product, variant=variant,
                                            location=location, quantity=Decimal('15'))
        layer = CostLayer.objects.create(business=self.business, product=product, variant=variant,
            location=location, received_quantity=Decimal('15'), remaining_quantity=Decimal('15'), unit_cost=Decimal('7.25'))
        cutoff = ensure_inventory_cutoff(self.business)
        self.assertEqual(cutoff.quantity, 15)
        self.assertEqual(cutoff.value, Decimal('108.75'))
        self.assertEqual(StockBalance.objects.get(pk=stock.pk).quantity, 15)
        self.assertEqual(CostLayer.objects.get(pk=layer.pk).remaining_quantity, 15)
        self.assertEqual(ensure_inventory_cutoff(self.business).pk, cutoff.pk)

    def test_opening_correction_is_linked_and_uses_fifo_cost(self):
        product = Product.objects.create(business=self.business, name='Pen', sku='PEN-OPEN')
        location = StockLocation.objects.get(business=self.business, is_default=True)
        opening = receive(product, location, Decimal('5'), Decimal('2.75'), self.owner, uuid.uuid4())
        post_adjustment(product, location, Decimal('2'), False, self.owner, uuid.uuid4(),
            'Opening count correction', financial_reason='opening_correction', opening_movement=opening)
        correction = StockMovement.objects.get(business=self.business, type='adjustment')
        self.assertEqual(correction.opening_movement_id, opening.pk)
        self.assertEqual(correction.inventory_cost, Decimal('-5.50'))
        self.assertEqual(balance(ledger(self.business, 'INVENTORY_LOSS')), 0)

    def test_transfer_preserves_inventory_ledger_value(self):
        product = Product.objects.create(business=self.business, name='Soap', sku='SOAP-TRANSFER')
        source = StockLocation.objects.get(business=self.business, is_default=True)
        target = StockLocation.objects.create(business=self.business, name='Warehouse', type='warehouse')
        receive(product, source, Decimal('4'), Decimal('2.50'), self.owner, uuid.uuid4())
        before = balance(ledger(self.business, 'INVENTORY'))
        post_transfer(product, source, target, Decimal('2'), self.owner, uuid.uuid4())
        self.assertEqual(balance(ledger(self.business, 'INVENTORY')), before)
        post_waste(product, target, Decimal('1'), self.owner, uuid.uuid4(), 'damaged')
        self.assertEqual(balance(ledger(self.business, 'INVENTORY')), Decimal('7.50'))

    def test_financial_failure_rolls_back_stock_consumption(self):
        product = Product.objects.create(business=self.business, name='Oil', sku='OIL-ROLLBACK')
        location = StockLocation.objects.get(business=self.business, is_default=True)
        receive(product, location, Decimal('3'), Decimal('4.00'), self.owner, uuid.uuid4())
        loss_account = ledger(self.business, 'INVENTORY_LOSS')
        loss_account.is_active = False
        loss_account.save(update_fields=['is_active'])
        with self.assertRaises(AccountingError):
            post_waste(product, location, Decimal('2'), self.owner, uuid.uuid4(), 'damaged')
        self.assertEqual(StockBalance.objects.get(product=product, location=location).quantity, 3)
        self.assertEqual(CostLayer.objects.get(product=product, location=location).remaining_quantity, 3)
        self.assertFalse(StockMovement.objects.filter(product=product, type='waste').exists())


@skipUnless(connection.vendor == 'postgresql', 'Concurrency test requires PostgreSQL')
class ConcurrentPostingTests(TransactionTestCase):
    def test_same_command_posts_once(self):
        user = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        business = Business.objects.create(name='Concurrent')
        setup_business(business)
        account = MoneyAccount.objects.get(business=business, is_default=True)
        command = uuid.uuid4()

        def worker():
            close_old_connections()
            try:
                return money_operation(business, user, command, 'owner_contribution', '10.00', account).pk
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: worker(), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(JournalEntry.objects.filter(business=business, command_id=command).count(), 1)
        self.assertEqual(balance(account.ledger_account), 10)
