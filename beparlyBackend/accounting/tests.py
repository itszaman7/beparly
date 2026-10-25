import json
import tempfile
import uuid
from io import BytesIO
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from unittest import skipUnless
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from accounts.models import Business, BusinessMember, User
from audit.models import AuditEvent
from products.models import Product, StockBatch
from stockkeeper.models import CostLayer, StockBalance, StockLocation, StockMovement
from stockkeeper.services import post_adjustment, post_transfer, post_waste, receive
from stockkeeper.services import business_today

from .models import BusinessAsset, Contact, Expense, ExpenseCategory, IncomeCategory, InventoryAccountingCutoff, JournalEntry, JournalLine, MoneyAccount, MoneyTransaction, RecordAttachment
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

    def test_contact_exposes_its_own_customer_and_supplier_ledgers(self):
        from accounts.models import AuthSession
        from purchases.services import supplier_data
        from .services import ensure_party_accounts

        contact = Contact.objects.create(business=self.business, name='Shared party',
                                         is_customer=True, is_supplier=True, created_by=self.owner)
        contact = ensure_party_accounts(contact)
        token = AuthSession.issue(self.owner)
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'}
        listing = self.client.get(f'/api/v1/businesses/{self.business.pk}/contacts/', **headers)
        row = next(item for item in listing.json()['contacts'] if item['id'] == str(contact.pk))
        self.assertEqual(row['customer_ledger_id'], contact.receivable_account.code)
        self.assertEqual(row['supplier_ledger_id'], contact.payable_account.code)
        self.assertEqual(supplier_data(contact)['supplier_ledger_id'], contact.payable_account.code)
        ledger = self.client.get(f'/api/v1/businesses/{self.business.pk}/money/accounts/{row["customer_ledger_id"]}/ledger/', **headers)
        self.assertEqual(ledger.status_code, 200, ledger.content)
        self.assertEqual(ledger.json()['account']['id'], row['customer_ledger_id'])

    def test_party_ledger_uses_full_balance_when_recent_entries_are_limited(self):
        from accounts.models import AuthSession
        from .services import cr, ensure_party_accounts

        contact = ensure_party_accounts(Contact.objects.create(
            business=self.business, name='Busy customer', is_customer=True, created_by=self.owner))
        opening = ledger(self.business, 'OPENING')
        for index in range(501):
            post(self.business, 'test_sale', str(index), f'Invoice {index}',
                 [dr(contact.receivable_account, 1, contact), cr(opening, 1)], actor=self.owner)
        token = AuthSession.issue(self.owner)
        response = self.client.get(
            f'/api/v1/businesses/{self.business.pk}/money/accounts/{contact.receivable_account.code}/ledger/',
            HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertTrue(result['truncated'])
        self.assertEqual(result['closing_balance'], '501')
        self.assertEqual(result['total_in'], '501')
        self.assertEqual(len(result['transactions']), 500)
        self.assertEqual(result['transactions'][0]['note'], 'Invoice 1')
        self.assertEqual(result['transactions'][-1]['note'], 'Invoice 500')

    def test_contacts_search_roles_and_pagination(self):
        from accounts.models import AuthSession

        Contact.objects.bulk_create([
            Contact(business=self.business, name=f'Customer {index:03}', is_customer=True)
            for index in range(101)
        ])
        Contact.objects.create(business=self.business, name='Only supplier', is_supplier=True)
        token = AuthSession.issue(self.owner)
        path = f'/api/v1/businesses/{self.business.pk}/contacts/'
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'}
        first = self.client.get(path, **headers).json()
        self.assertEqual(len(first['contacts']), 100)
        self.assertEqual(first['next_page'], 2)
        second = self.client.get(path + '?page=2', **headers).json()
        self.assertEqual(len(second['contacts']), 2)
        self.assertIsNone(second['next_page'])
        supplier = self.client.get(path + '?role=supplier', **headers).json()
        self.assertEqual([item['name'] for item in supplier['contacts']], ['Only supplier'])
        searched = self.client.get(path + '?search=Customer%20100&role=customer', **headers).json()
        self.assertEqual([item['name'] for item in searched['contacts']], ['Customer 100'])

    def test_setup_and_balanced_idempotent_posting(self):
        setup_business(self.business)
        self.assertEqual(MoneyAccount.objects.filter(business=self.business).count(), 1)
        self.assertEqual(IncomeCategory.objects.filter(business=self.business, name='Miscellaneous income').count(), 1)
        self.assertEqual(AuditEvent.objects.filter(business=self.business, entity_type='income_category',
            subject='Miscellaneous income').count(), 1)
        command = uuid.uuid4()
        txn = money_operation(self.business, self.owner, command, 'owner_contribution', '120.00', self.cash)
        self.assertEqual(balance(self.cash.ledger_account), Decimal('120'))
        self.assertEqual(txn.journal.lines.get(account=ledger(self.business, 'CAPITAL')).credit, Decimal('120'))
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
        advance = money_operation(self.business, self.owner, uuid.uuid4(), 'customer_advance', 50, self.cash, contact=customer)
        self.assertEqual(advance.journal.lines.get(account=ledger(self.business, 'CUSTOMER_ADVANCE')).credit, Decimal('50'))
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

    def test_new_account_opening_balance_is_atomic_and_idempotent(self):
        command = uuid.uuid4()
        account = create_money_account(self.business, 'Wallet', 'wallet', command_id=command,
                                       opening_balance='125.50', actor=self.owner)
        self.assertEqual(balance(account.ledger_account), Decimal('125.50'))
        self.assertEqual(balance(ledger(self.business, 'OPENING')), Decimal('-125.50'))
        opening = MoneyTransaction.objects.get(account=account, kind='opening_balance')
        self.assertEqual(opening.journal.command_id, command)
        self.assertEqual(opening.journal.posting_date, opening.event_date)
        self.assertEqual(create_money_account(self.business, 'Wallet', 'wallet', command_id=command,
            opening_balance='125.50', actor=self.owner).pk, account.pk)
        self.assertEqual(MoneyTransaction.objects.filter(account=account).count(), 1)
        with self.assertRaises(AccountingError):
            create_money_account(self.business, 'Wallet', 'wallet', command_id=command, opening_balance='10')
        zero = create_money_account(self.business, 'Zero', 'bank', command_id=uuid.uuid4())
        self.assertEqual(balance(zero.ledger_account), 0)
        self.assertFalse(MoneyTransaction.objects.filter(account=zero).exists())
        before = MoneyAccount.objects.count()
        with self.assertRaises(AccountingError):
            create_money_account(self.business, 'Invalid', 'bank', command_id=uuid.uuid4(), opening_balance='-1')
        self.assertEqual(MoneyAccount.objects.count(), before)
        failed_command = uuid.uuid4()
        with patch('accounting.services.post', side_effect=AccountingError('Posting failed')):
            with self.assertRaises(AccountingError):
                create_money_account(self.business, 'Retry', 'wallet', command_id=failed_command,
                                     opening_balance='5', actor=self.owner)
        self.assertFalse(MoneyAccount.objects.filter(create_command_id=failed_command).exists())
        self.assertFalse(JournalEntry.objects.filter(command_id=failed_command).exists())
        self.assertEqual(create_money_account(self.business, 'Retry', 'wallet', command_id=failed_command,
            opening_balance='5', actor=self.owner).name, 'Retry')

    def test_expense_reference_and_backdated_idempotency(self):
        category = create_financial_category(self.business, self.owner, 'Rent', 'expense')
        command = uuid.uuid4()
        event_date = date(2025, 1, 3)
        transaction = money_operation(self.business, self.owner, command, 'expense', '42.50', self.cash,
            category=category, event_date=event_date, reference='V-103', note='January rent')
        self.assertEqual(Expense.objects.get(money_transaction=transaction).reference, 'V-103')
        self.assertEqual(transaction.note, 'January rent')
        self.assertEqual(transaction.journal.event_date, event_date)
        self.assertEqual(transaction.journal.posting_date, business_today(self.business))
        self.assertEqual(balance(category.ledger_account), Decimal('42.50'))
        self.assertEqual(balance(self.cash.ledger_account), Decimal('-42.50'))
        self.assertEqual(money_operation(self.business, self.owner, command, 'expense', '42.50', self.cash,
            category=category, event_date=event_date, reference='V-103', note='January rent').pk, transaction.pk)
        for override in ({'reference': 'Changed'}, {'event_date': date(2025, 1, 4)}):
            with self.assertRaises(AccountingError):
                money_operation(self.business, self.owner, command, 'expense', '42.50', self.cash,
                    category=category, event_date=override.get('event_date', event_date),
                    reference=override.get('reference', 'V-103'), note='January rent')
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'expense', '0', self.cash, category=category)
        other = Business.objects.create(name='Other expense business')
        setup_business(other)
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'expense', '1', self.cash,
                category=create_financial_category(other, None, 'Other rent', 'expense'))

    def test_expense_and_purchase_attachments_are_private_and_retry_safe(self):
        from accounts.models import AuthSession
        from purchases.models import Purchase

        category = create_financial_category(self.business, self.owner, 'Rent', 'expense')
        expense = money_operation(self.business, self.owner, uuid.uuid4(), 'expense', '10', self.cash,
                                  category=category)
        supplier = Contact.objects.create(business=self.business, name='Supplier', is_supplier=True)
        location = StockLocation.objects.get(business=self.business, is_default=True)
        purchase = Purchase.objects.create(business=self.business, supplier=supplier, location=location,
            actor=self.owner, create_command_id=uuid.uuid4())
        headers = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(self.owner)}'}
        expense_path = f'/api/v1/businesses/{self.business.pk}/attachments/expense/{expense.pk}/'
        purchase_path = f'/api/v1/businesses/{self.business.pk}/attachments/purchase/{purchase.pk}/'
        image_bytes = BytesIO()
        Image.new('RGB', (2, 2), 'red').save(image_bytes, format='PNG')
        with tempfile.TemporaryDirectory() as private_root, override_settings(DEBUG=True, ATTACHMENT_ROOT=private_root):
            command = str(uuid.uuid4())
            def image_file():
                return SimpleUploadedFile('receipt.png', image_bytes.getvalue(), content_type='image/png')
            first = self.client.post(expense_path, {'file': image_file()},
                HTTP_X_COMMAND_ID=command, **headers)
            self.assertEqual(first.status_code, 201, first.content)
            attachment_id = first.json()['attachment']['id']
            self.assertTrue((Path(private_root) / RecordAttachment.objects.get(pk=attachment_id).file_key).is_file())
            retry = self.client.post(expense_path, {'file': image_file()},
                HTTP_X_COMMAND_ID=command, **headers)
            self.assertEqual(retry.status_code, 200, retry.content)
            self.assertEqual(retry.json()['attachment']['id'], attachment_id)
            self.assertEqual(RecordAttachment.objects.count(), 1)
            mismatch = self.client.post(purchase_path, {'file': image_file()},
                HTTP_X_COMMAND_ID=command, **headers)
            self.assertEqual(mismatch.status_code, 400)
            bad = self.client.post(expense_path, {'file': SimpleUploadedFile('fake.pdf', b'not a PDF')},
                HTTP_X_COMMAND_ID=str(uuid.uuid4()), **headers)
            self.assertEqual(bad.status_code, 400)
            too_large = self.client.post(expense_path,
                {'file': SimpleUploadedFile('huge.pdf', b'%PDF-' + b'X' * (10 * 1024 * 1024) + b'%%EOF')},
                HTTP_X_COMMAND_ID=str(uuid.uuid4()), **headers)
            self.assertEqual(too_large.status_code, 400)
            pdf = b'%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'
            purchase_response = self.client.post(purchase_path,
                {'file': SimpleUploadedFile('bill.pdf', pdf, content_type='application/pdf')},
                HTTP_X_COMMAND_ID=str(uuid.uuid4()), **headers)
            self.assertEqual(purchase_response.status_code, 201, purchase_response.content)
            file_response = self.client.get(expense_path + attachment_id + '/', **headers)
            self.assertEqual(file_response.status_code, 200)
            self.assertEqual(b''.join(file_response.streaming_content), image_bytes.getvalue())
            self.assertEqual(file_response['Cache-Control'], 'private, no-store')
            detail = self.client.get(f'/api/v1/businesses/{self.business.pk}/money/expenses/{expense.pk}/', **headers)
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()['transaction']['category_name'], 'Rent')
            other = Business.objects.create(name='Other documents')
            setup_business(other)
            self.assertEqual(self.client.get(f'/api/v1/businesses/{other.pk}/attachments/expense/{expense.pk}/',
                **headers).status_code, 404)
            employee = User.objects.create_user(phone='01712345679', password='StaffPass#83')
            BusinessMember.objects.create(user=employee, business=self.business, role=BusinessMember.EMPLOYEE)
            staff = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(employee)}'}
            self.assertEqual(self.client.get(expense_path, **staff).status_code, 403)
            self.assertEqual(self.client.get(purchase_path, **staff).status_code, 403)
            member = BusinessMember.objects.get(user=employee, business=self.business)
            member.can_manage_purchases = True
            member.save(update_fields=['can_manage_purchases'])
            self.assertEqual(self.client.get(purchase_path, **staff).status_code, 200)

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

    def test_retired_asset_routes_do_not_accept_new_transactions(self):
        asset = purchase_asset(self.business, self.owner, uuid.uuid4(), 'Old shelf', 120, 0, 12,
            date(2025, 1, 1), self.cash)
        base = f'/api/v1/businesses/{self.business.pk}/assets/'
        self.assertEqual(self.client.get(base).status_code, 404)
        self.assertEqual(self.client.post(base, '{}', content_type='application/json').status_code, 404)
        self.assertEqual(self.client.post(f'{base}{asset.pk}/sell/', '{}', content_type='application/json').status_code, 404)
        self.assertTrue(BusinessAsset.objects.filter(pk=asset.pk).exists())
        self.assertEqual(JournalEntry.objects.filter(pk=asset.purchase_journal_id).count(), 1)

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
        self.assertEqual(income_txn.journal.lines.get(account=self.cash.ledger_account).debit, Decimal('15'))
        self.assertEqual(income_txn.journal.lines.get(account=income.ledger_account).credit, Decimal('15'))
        self.assertEqual(income_txn.income_category_id, income.pk)
        self.assertEqual(sum((line.debit for line in income_txn.journal.lines.all()), Decimal('0')),
                         sum((line.credit for line in income_txn.journal.lines.all()), Decimal('0')))
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'other_income', 10, self.cash)
        sales_category = create_financial_category(self.business, self.owner, 'Sales', 'income')
        with self.assertRaises(AccountingError):
            money_operation(self.business, self.owner, uuid.uuid4(), 'other_income', 10, self.cash,
                            income_category=sales_category)

    def test_money_in_api_uses_miscellaneous_income_and_retries_once(self):
        token = self.client.post('/api/v1/auth/login/', json.dumps({'phone': self.owner.phone,
            'password': 'OwnerPass#83'}), content_type='application/json').json()['token']
        category = IncomeCategory.objects.get(business=self.business, name='Miscellaneous income')
        path = f'/api/v1/businesses/{self.business.pk}/money/transactions/'
        payload = {'kind': 'other_income', 'amount': '25.00', 'account_id': str(self.cash.pk),
                   'category_id': category.pk, 'note': 'Delivery charge'}
        command = str(uuid.uuid4())
        def submit(data, key):
            return self.client.post(path, json.dumps(data), content_type='application/json',
                HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_COMMAND_ID=key)
        first = submit(payload, command)
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(submit(payload, command).json()['transaction']['id'], first.json()['transaction']['id'])
        txn = MoneyTransaction.objects.get(pk=first.json()['transaction']['id'])
        self.assertEqual(txn.journal.lines.get(account=self.cash.ledger_account).debit, Decimal('25'))
        self.assertEqual(txn.journal.lines.get(account=category.ledger_account).credit, Decimal('25'))
        self.assertEqual(JournalEntry.objects.filter(business=self.business, command_id=command).count(), 1)
        sales_category = create_financial_category(self.business, self.owner, 'Sales', 'income')
        self.assertEqual(submit({**payload, 'category_id': sales_category.pk}, str(uuid.uuid4())).status_code, 400)

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

    def test_expense_api_reference_account_opening_and_owner_scope(self):
        from accounts.models import AuthSession
        token = AuthSession.issue(self.owner)
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'}
        account_path = f'/api/v1/businesses/{self.business.pk}/money/accounts/'
        account_command = str(uuid.uuid4())
        created = self.client.post(account_path, json.dumps({'name': 'bKash', 'kind': 'wallet',
            'opening_balance': '75.25'}), content_type='application/json', HTTP_X_COMMAND_ID=account_command, **headers)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(Decimal(created.json()['account']['balance']), Decimal('75.25'))
        repeat = self.client.post(account_path, json.dumps({'name': 'bKash', 'kind': 'wallet',
            'opening_balance': '75.25'}), content_type='application/json', HTTP_X_COMMAND_ID=account_command, **headers)
        self.assertEqual(repeat.json()['account']['id'], created.json()['account']['id'])
        category_path = f'/api/v1/businesses/{self.business.pk}/money/expense-categories/'
        category_response = self.client.post(category_path, json.dumps({'name': 'Transport'}),
            content_type='application/json', **headers)
        self.assertEqual(category_response.status_code, 201, category_response.content)
        category = ExpenseCategory.objects.get(pk=category_response.json()['category']['id'])
        self.assertEqual(category.ledger_account.type, 'expense')
        command = str(uuid.uuid4())
        path = f'/api/v1/businesses/{self.business.pk}/money/transactions/'
        payload = {'kind': 'expense', 'amount': '10.50', 'account_id': created.json()['account']['id'],
            'category_id': category.pk, 'reference': 'INV-7', 'note': 'Rickshaw', 'event_date': '2025-01-03'}
        response = self.client.post(path, json.dumps(payload), content_type='application/json',
            HTTP_X_COMMAND_ID=command, **headers)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['transaction']['reference'], 'INV-7')
        self.assertEqual(response.json()['transaction']['note'], 'Rickshaw')
        repeated = self.client.post(path, json.dumps(payload), content_type='application/json',
            HTTP_X_COMMAND_ID=command, **headers)
        self.assertEqual(repeated.json()['transaction']['id'], response.json()['transaction']['id'])
        changed = self.client.post(path, json.dumps({**payload, 'reference': 'INV-8'}),
            content_type='application/json', HTTP_X_COMMAND_ID=command, **headers)
        self.assertEqual(changed.status_code, 400)
        other = Business.objects.create(name='Other business')
        setup_business(other)
        forbidden = self.client.post(f'/api/v1/businesses/{other.pk}/money/transactions/', json.dumps(payload),
            content_type='application/json', HTTP_X_COMMAND_ID=str(uuid.uuid4()), **headers)
        self.assertEqual(forbidden.status_code, 404)
        staff = User.objects.create_user(phone='01712345679', password='StaffPass#83')
        BusinessMember.objects.create(user=staff, business=self.business, role=BusinessMember.EMPLOYEE)
        staff_headers = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(staff)}'}
        self.assertEqual(self.client.get(account_path, **staff_headers).status_code, 403)

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
