import json
import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.db import connection
from django.test import TestCase

from accounts.models import AuthSession, Business, BusinessMember, User
from accounting.models import Contact, IncomeCategory, JournalEntry, MoneyAccount, MoneyTransaction
from accounting.reconciliation import reconcile_business
from accounting.services import balance, ledger, setup_business
from audit.models import AuditEvent
from products.models import Product, StockBatch
from stockkeeper.models import StockBalance, StockLocation, StockMovement
from stockkeeper.services import receive

from .models import Sale, SalePayment, SaleReturnReceipt, SaleReturnDisposition
from .return_workflow import receive_credited_goods, decide_inspected_goods, refund_credited_sale
from .services import SaleError, cancel_sale, collect_sale, create_sale, return_sale, serialize_sale


class ReturnWorkflowTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        self.business = Business.objects.create(name='Return Workflow')
        BusinessMember.objects.create(user=self.owner, business=self.business,
            role=BusinessMember.OWNER)
        setup_business(self.business)
        self.location = StockLocation.objects.get(business=self.business, is_default=True)
        self.location.address = 'Main Shop, Dhaka'
        self.location.save(update_fields=['address'])
        self.cash = MoneyAccount.objects.get(business=self.business, is_default=True)
        self.product = Product.objects.create(business=self.business, name='Soap',
            sku='SOAP-RETURN', base_unit='Piece', retail_price=Decimal('10.00'))
        receive(self.product, self.location, Decimal('10'), Decimal('4.00'),
            self.owner, uuid.uuid4())

    def sale(self, *, paid='20.00', customer=None, lines=None, account=None):
        payload = {'mode': 'manual', 'price_tier': 'retail', 'location_id': self.location.pk,
            'paid': paid, 'due_date': (date.today() + timedelta(days=30)).isoformat(),
            'lines': lines or [{'product_id': str(self.product.pk), 'quantity': '2'}]}
        if customer:
            payload['customer_id'] = str(customer.pk)
        if Decimal(paid):
            payload['account_id'] = str((account or self.cash).pk)
        return create_sale(self.business, self.owner, uuid.uuid4(), payload)

    def credit(self, sale, quantity='2', command=None):
        data = {'reason': 'Customer accepted credit',
                'lines': [{'line_id': sale.lines.get().pk, 'quantity': quantity}]}
        return return_sale(sale, self.owner, command or uuid.uuid4(), data)

    def receipt_data(self, credit, quantity='1', condition='sellable', location=None):
        line = credit.lines.get()
        sold = line.sale_line
        return {'return_line_id': line.pk, 'product_id': str(sold.product_id),
            'variant_id': str(sold.variant_id),
            'batch_id': str(sold.batch_id) if sold.batch_id else None,
            'quantity': quantity, 'location_id': (location or self.location).pk,
            'condition': condition, 'received_confirmed': True,
            'evidence_reference': 'RECEIVED-001'}

    def test_completed_cancel_blocked_credit_does_not_invent_stock_or_refund(self):
        sale = self.sale()
        before = StockBalance.objects.get(product=self.product, location=self.location).quantity
        with self.assertRaisesMessage(SaleError, 'explicit credit'):
            cancel_sale(sale, self.owner, uuid.uuid4(), 'Wrong order')
        credit = self.credit(sale)
        sale.refresh_from_db()
        self.assertEqual(sale.status, 'completed')
        self.assertEqual(sale.paid, Decimal('20'))
        self.assertEqual(balance(self.cash.ledger_account), Decimal('20'))
        self.assertEqual(StockBalance.objects.get(product=self.product,
            location=self.location).quantity, before)
        self.assertFalse(StockMovement.objects.filter(type='sale_return').exists())
        self.assertFalse(SalePayment.objects.filter(sale=sale, kind='refund').exists())
        self.assertEqual(balance(ledger(self.business, 'CUSTOMER_REFUND')), Decimal('-20'))
        self.assertEqual(serialize_sale(sale)['refund_outstanding'], '20.00')
        self.assertEqual(credit.refund_amount, 0)
        self.assertTrue(AuditEvent.objects.filter(business=self.business,
            entity_type='sale_return', action='credit_posted', entity_id=credit.pk).exists())
        credit.reason = 'Changed later'
        with self.assertRaisesMessage(ValueError, 'cannot be changed'):
            credit.save(update_fields=['reason'])
        self.assertEqual(reconcile_business(self.business), [])

    def test_credit_sale_reduces_due_without_refund(self):
        customer = Contact.objects.create(business=self.business, name='Karim',
            phone='01712345679', is_customer=True)
        sale = self.sale(paid='5.00', customer=customer)
        credit = self.credit(sale, quantity='1')
        sale.refresh_from_db()
        customer.refresh_from_db()
        self.assertEqual(credit.due_reduction, Decimal('10'))
        self.assertEqual(serialize_sale(sale)['due'], '5.00')
        self.assertEqual(serialize_sale(sale)['refund_outstanding'], '0')
        self.assertEqual(balance(customer.receivable_account), Decimal('5'))
        self.assertEqual(balance(self.cash.ledger_account), Decimal('5'))
        self.assertEqual(reconcile_business(self.business), [])

    def test_sellable_and_damaged_receipts_are_separate_and_partial(self):
        sale = self.sale()
        credit = self.credit(sale)
        warehouse = StockLocation.objects.create(business=self.business, name='Returns warehouse',
            type='warehouse')
        first = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            self.receipt_data(credit, '1', 'sellable', warehouse))
        second = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            {**self.receipt_data(credit, '1', 'damaged'), 'evidence_reference': 'DAMAGED-002'})
        self.assertEqual(StockBalance.objects.get(product=self.product,
            location=warehouse).quantity, Decimal('1'))
        self.assertEqual(StockBalance.objects.get(product=self.product,
            location=self.location).quantity, Decimal('8'))
        self.assertIsNotNone(first.movement_id)
        self.assertIsNone(second.movement_id)
        self.assertEqual(balance(ledger(self.business, 'INVENTORY')), Decimal('36'))
        self.assertEqual(balance(ledger(self.business, 'INVENTORY_LOSS')), Decimal('4'))
        self.assertEqual(balance(ledger(self.business, 'COGS')), Decimal('0'))
        self.assertEqual(credit.lines.get().receipts.count(), 2)
        self.assertEqual(reconcile_business(self.business), [])

    def test_inspection_holds_custody_without_value_until_restocked(self):
        sale = self.sale()
        credit = self.credit(sale)
        before = StockBalance.objects.get(product=self.product, location=self.location).quantity
        receipt = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            self.receipt_data(credit, '2', 'inspection'))
        self.assertEqual(receipt.inventory_cost, Decimal('8'))
        self.assertIsNone(receipt.journal_id)
        self.assertIsNone(receipt.movement_id)
        self.assertEqual(StockBalance.objects.get(product=self.product,
            location=self.location).quantity, before)
        self.assertEqual(serialize_sale(sale, True)['returns'][0]['lines'][0]['receipts'][0]['status'], 'inspection')
        self.assertEqual(reconcile_business(self.business), [])
        data = {'action': 'restocked', 'decision_confirmed': True,
            'evidence_reference': 'INSPECTED-SELLABLE', 'supplier_id': None}
        command = uuid.uuid4()
        decision = decide_inspected_goods(receipt, self.owner, command, data)
        self.assertEqual(decide_inspected_goods(receipt, self.owner, command, data).pk, decision.pk)
        with self.assertRaisesMessage(SaleError, 'original details'):
            decide_inspected_goods(receipt, self.owner, command,
                {**data, 'action': 'written_off'})
        self.assertEqual(StockBalance.objects.get(product=self.product,
            location=self.location).quantity, before + Decimal('2'))
        self.assertEqual(balance(ledger(self.business, 'INVENTORY')), Decimal('40'))
        self.assertEqual(serialize_sale(sale, True)['returns'][0]['lines'][0]['receipts'][0]['status'], 'restocked')
        self.assertEqual(reconcile_business(self.business), [])

    def test_inspection_writeoff_and_supplier_dispatch_never_create_sellable_stock(self):
        sale = self.sale()
        credit = self.credit(sale)
        receipt = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            self.receipt_data(credit, '1', 'inspection'))
        written_off = decide_inspected_goods(receipt, self.owner, uuid.uuid4(),
            {'action': 'written_off', 'decision_confirmed': True,
             'evidence_reference': 'INSPECTED-DAMAGED', 'supplier_id': None})
        self.assertIsNone(written_off.movement_id)
        self.assertEqual(balance(ledger(self.business, 'INVENTORY_LOSS')), Decimal('4'))
        other_receipt = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            {**self.receipt_data(credit, '1', 'inspection'), 'evidence_reference': 'HELD-2'})
        other_business = Business.objects.create(name='Wrong supplier business')
        wrong_supplier = Contact.objects.create(business=other_business, name='Wrong supplier',
            is_supplier=True)
        with self.assertRaisesMessage(SaleError, 'supplier in this business'):
            decide_inspected_goods(other_receipt, self.owner, uuid.uuid4(),
                {'action': 'returned_to_supplier', 'decision_confirmed': True,
                 'evidence_reference': 'WRONG-DISPATCH', 'supplier_id': str(wrong_supplier.pk)})
        supplier = Contact.objects.create(business=self.business, name='Supplier', is_supplier=True)
        dispatched = decide_inspected_goods(other_receipt, self.owner, uuid.uuid4(),
            {'action': 'returned_to_supplier', 'decision_confirmed': True,
             'evidence_reference': 'DISPATCH-2', 'supplier_id': str(supplier.pk)})
        self.assertEqual(dispatched.supplier_id, supplier.pk)
        self.assertIsNone(dispatched.journal_id)
        self.assertIsNone(dispatched.movement_id)
        self.assertEqual(StockBalance.objects.get(product=self.product,
            location=self.location).quantity, Decimal('8'))
        self.assertEqual(balance(ledger(self.business, 'INVENTORY')), Decimal('32'))
        self.assertEqual(reconcile_business(self.business), [])

    def test_inspection_decision_rolls_back_stock_if_posting_fails(self):
        sale = self.sale()
        credit = self.credit(sale)
        receipt = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            self.receipt_data(credit, '1', 'inspection'))
        before = StockBalance.objects.get(product=self.product, location=self.location).quantity
        cogs = ledger(self.business, 'COGS')
        cogs.is_active = False
        cogs.save(update_fields=['is_active'])
        with self.assertRaises(ValueError):
            decide_inspected_goods(receipt, self.owner, uuid.uuid4(),
                {'action': 'restocked', 'decision_confirmed': True,
                 'evidence_reference': 'INSPECT-FAIL', 'supplier_id': None})
        self.assertFalse(SaleReturnDisposition.objects.filter(business=self.business).exists())
        self.assertEqual(StockBalance.objects.get(product=self.product,
            location=self.location).quantity, before)

    def test_partial_inspections_keep_distinct_original_fifo_costs(self):
        product = Product.objects.create(business=self.business, name='Mixed cost',
            sku='MIXED-RETURN', retail_price=Decimal('10.00'))
        receive(product, self.location, Decimal('1'), Decimal('2.00'), self.owner, uuid.uuid4())
        receive(product, self.location, Decimal('1'), Decimal('6.00'), self.owner, uuid.uuid4())
        sale = self.sale(lines=[{'product_id': str(product.pk), 'quantity': '2'}])
        credit = self.credit(sale)
        first = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            self.receipt_data(credit, '1', 'inspection'))
        second = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            {**self.receipt_data(credit, '1', 'inspection'),
             'evidence_reference': 'INSPECT-SECOND'})
        self.assertEqual((first.inventory_cost, second.inventory_cost),
            (Decimal('2.00'), Decimal('6.00')))
        decide_inspected_goods(second, self.owner, uuid.uuid4(),
            {'action': 'restocked', 'decision_confirmed': True,
             'evidence_reference': 'SECOND-SELLABLE', 'supplier_id': None})
        decide_inspected_goods(first, self.owner, uuid.uuid4(),
            {'action': 'written_off', 'decision_confirmed': True,
             'evidence_reference': 'FIRST-DAMAGED', 'supplier_id': None})
        self.assertEqual(balance(ledger(self.business, 'INVENTORY_LOSS')), Decimal('2'))
        self.assertEqual(reconcile_business(self.business), [])

    def test_partial_and_full_refund_require_execution_and_account(self):
        sale = self.sale(paid='10.00', customer=Contact.objects.create(
            business=self.business, name='Buyer', phone='01712345679', is_customer=True))
        other_cash = MoneyAccount.objects.create(business=self.business,
            ledger_account=self.business.ledgeraccount_set.create(code='MONEY-SECOND',
                name='Second Cash', type='asset'), name='Second Cash', kind='cash')
        collect_sale(sale, self.owner, uuid.uuid4(), '10.00', other_cash)
        credit = self.credit(sale)
        self.assertEqual(serialize_sale(sale)['refund_outstanding'], '20.00')
        first_data = {'amount': '7.00', 'account_id': str(self.cash.pk),
            'refund_confirmed': True, 'confirmation_reference': 'CASH-REF-1'}
        command = uuid.uuid4()
        first = refund_credited_sale(credit, self.owner, command, first_data)
        self.assertEqual(refund_credited_sale(credit, self.owner, command, first_data).pk, first.pk)
        with self.assertRaisesMessage(SaleError, 'original details'):
            refund_credited_sale(credit, self.owner, command, {**first_data, 'amount': '8.00'})
        sale.refresh_from_db()
        self.assertEqual(serialize_sale(sale)['refund_outstanding'], '13.00')
        self.assertEqual(sale.paid, Decimal('13'))
        refund_credited_sale(credit, self.owner, uuid.uuid4(), {'amount': '13.00',
            'account_id': str(other_cash.pk), 'refund_confirmed': True,
            'confirmation_reference': 'WALLET-REF-2'})
        sale.refresh_from_db()
        self.assertEqual(sale.paid, 0)
        self.assertEqual(serialize_sale(sale)['refund_outstanding'], '0')
        self.assertEqual(balance(ledger(self.business, 'CUSTOMER_REFUND')), 0)
        self.assertEqual(balance(self.cash.ledger_account), Decimal('3'))
        self.assertEqual(balance(other_cash.ledger_account), Decimal('-3'))
        self.assertEqual(MoneyTransaction.objects.filter(business=self.business,
            kind='sale_refund').count(), 2)
        self.assertEqual(reconcile_business(self.business), [])

    def test_rejects_changed_credit_and_receipt_retries_and_wrong_variant(self):
        sale = self.sale()
        command = uuid.uuid4()
        credit = self.credit(sale, command=command)
        self.assertEqual(self.credit(sale, command=command).pk, credit.pk)
        with self.assertRaisesMessage(SaleError, 'original details'):
            self.credit(sale, quantity='1', command=command)
        data = self.receipt_data(credit)
        with self.assertRaisesMessage(SaleError, 'Confirm the exact goods'):
            receive_credited_goods(credit, self.owner, uuid.uuid4(),
                {**data, 'received_confirmed': False})
        with self.assertRaisesMessage(SaleError, 'must match'):
            receive_credited_goods(credit, self.owner, uuid.uuid4(),
                {**data, 'variant_id': str(uuid.uuid4())})
        receipt_command = uuid.uuid4()
        first = receive_credited_goods(credit, self.owner, receipt_command, data)
        self.assertEqual(receive_credited_goods(credit, self.owner, receipt_command, data).pk, first.pk)
        with self.assertRaisesMessage(SaleError, 'original details'):
            receive_credited_goods(credit, self.owner, receipt_command,
                {**data, 'quantity': '2'})
        self.assertEqual(SaleReturnReceipt.objects.filter(business=self.business).count(), 1)

    def test_receipt_rolls_back_stock_if_financial_posting_fails(self):
        sale = self.sale()
        credit = self.credit(sale)
        before = StockBalance.objects.get(product=self.product, location=self.location).quantity
        cogs = ledger(self.business, 'COGS')
        cogs.is_active = False
        cogs.save(update_fields=['is_active'])
        with self.assertRaises(ValueError):
            receive_credited_goods(credit, self.owner, uuid.uuid4(), self.receipt_data(credit))
        self.assertEqual(StockBalance.objects.get(product=self.product,
            location=self.location).quantity, before)
        self.assertFalse(SaleReturnReceipt.objects.filter(business=self.business).exists())
        self.assertFalse(StockMovement.objects.filter(type='sale_return').exists())

    def test_refund_rolls_back_payment_and_sale_if_financial_posting_fails(self):
        sale = self.sale()
        credit = self.credit(sale)
        refund_ledger = ledger(self.business, 'CUSTOMER_REFUND')
        refund_ledger.is_active = False
        refund_ledger.save(update_fields=['is_active'])
        before_money = balance(self.cash.ledger_account)
        with self.assertRaises(ValueError):
            refund_credited_sale(credit, self.owner, uuid.uuid4(), {
                'amount': '5.00', 'account_id': str(self.cash.pk),
                'refund_confirmed': True, 'confirmation_reference': 'EXEC-ROLLBACK'})
        sale.refresh_from_db()
        self.assertEqual(sale.paid, Decimal('20.00'))
        self.assertEqual(balance(self.cash.ledger_account), before_money)
        self.assertFalse(SalePayment.objects.filter(sale=sale, kind='refund').exists())
        self.assertFalse(MoneyTransaction.objects.filter(business=self.business,
            kind='sale_refund').exists())

    def test_expired_batch_cannot_be_marked_sellable(self):
        product = Product.objects.create(business=self.business, name='Milk', sku='MILK-R',
            tracking_mode='expiry', retail_price=Decimal('10.00'))
        variant = product.variants.get(is_default=True)
        batch = StockBatch.objects.create(product=product, variant=variant, lot_code='LOT-1',
            expires_on=date.today() + timedelta(days=1))
        receive(product, self.location, Decimal('1'), Decimal('3'), self.owner, uuid.uuid4(), batch=batch)
        sale = self.sale(paid='10.00', lines=[{'product_id': str(product.pk),
            'batch_id': str(batch.pk), 'quantity': '1'}])
        credit = self.credit(sale, quantity='1')
        batch.expires_on = date.today() - timedelta(days=1)
        batch.save(update_fields=['expires_on'])
        with self.assertRaisesMessage(SaleError, 'Expired goods'):
            receive_credited_goods(credit, self.owner, uuid.uuid4(), self.receipt_data(credit))
        with self.assertRaisesMessage(SaleError, 'must match'):
            receive_credited_goods(credit, self.owner, uuid.uuid4(),
                {**self.receipt_data(credit), 'batch_id': str(uuid.uuid4())})
        held = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            self.receipt_data(credit, condition='inspection'))
        with self.assertRaisesMessage(SaleError, 'Expired goods'):
            decide_inspected_goods(held, self.owner, uuid.uuid4(),
                {'action': 'restocked', 'decision_confirmed': True,
                 'evidence_reference': 'EXPIRED-NO-RESTOCK', 'supplier_id': None})

    def test_api_refund_permission_confirmation_and_cross_business_scope(self):
        sale = self.sale()
        credit = self.credit(sale)
        path = f'/api/v1/businesses/{self.business.pk}/sales/{sale.pk}/returns/{credit.pk}/refunds/'
        headers = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(self.owner)}',
            'HTTP_X_COMMAND_ID': str(uuid.uuid4())}
        data = {'amount': '5.00', 'account_id': str(self.cash.pk),
            'refund_confirmed': False, 'confirmation_reference': 'EXEC-1'}
        self.assertEqual(self.client.post(path, json.dumps(data), content_type='application/json',
            **headers).status_code, 400)
        other = Business.objects.create(name='Other')
        setup_business(other)
        self.assertEqual(self.client.post(path.replace(f'/{self.business.pk}/', f'/{other.pk}/', 1),
            json.dumps({**data, 'refund_confirmed': True}), content_type='application/json',
            **headers).status_code, 404)
        self.assertFalse(SalePayment.objects.filter(sale=sale, kind='refund').exists())

    def test_staff_can_confirm_goods_but_cannot_issue_credit_or_refund(self):
        sale = self.sale()
        credit = self.credit(sale)
        staff = User.objects.create_user(phone='01712345670', password='StaffPass#83')
        BusinessMember.objects.create(user=staff, business=self.business,
            role=BusinessMember.EMPLOYEE, can_post_stock=True)
        auth = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(staff)}',
            'HTTP_X_COMMAND_ID': str(uuid.uuid4())}
        root = f'/api/v1/businesses/{self.business.pk}/sales/{sale.pk}/returns/'
        self.assertEqual(self.client.post(root, json.dumps({'reason': 'Credit', 'lines': []}),
            content_type='application/json', **auth).status_code, 403)
        self.assertEqual(self.client.post(root + f'{credit.pk}/refunds/',
            json.dumps({'amount': '1.00', 'account_id': str(self.cash.pk),
                'refund_confirmed': True, 'confirmation_reference': 'EXEC-1'}),
            content_type='application/json', **auth).status_code, 403)
        response = self.client.post(root + f'{credit.pk}/receipts/',
            json.dumps(self.receipt_data(credit)), content_type='application/json', **auth)
        self.assertEqual(response.status_code, 201, response.content)
        other = Business.objects.create(name='Other return business')
        setup_business(other)
        cross_business = root.replace(f'/{self.business.pk}/', f'/{other.pk}/', 1)
        self.assertEqual(self.client.post(cross_business + f'{credit.pk}/receipts/',
            json.dumps(self.receipt_data(credit)), content_type='application/json',
            **auth).status_code, 404)

    def test_inspection_api_requires_owner_confirmation_and_business_scope(self):
        sale = self.sale()
        credit = self.credit(sale)
        receipt = receive_credited_goods(credit, self.owner, uuid.uuid4(),
            self.receipt_data(credit, '1', 'inspection'))
        path = (f'/api/v1/businesses/{self.business.pk}/sales/{sale.pk}/returns/'
            f'{credit.pk}/receipts/{receipt.pk}/dispositions/')
        staff = User.objects.create_user(phone='01712345670', password='StaffPass#83')
        BusinessMember.objects.create(user=staff, business=self.business,
            role=BusinessMember.EMPLOYEE, can_post_stock=True)
        data = {'action': 'written_off', 'decision_confirmed': True,
            'evidence_reference': 'INSPECT-API', 'supplier_id': None}
        headers = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(staff)}',
            'HTTP_X_COMMAND_ID': str(uuid.uuid4())}
        self.assertEqual(self.client.post(path, json.dumps(data),
            content_type='application/json', **headers).status_code, 403)
        headers['HTTP_AUTHORIZATION'] = f'Bearer {AuthSession.issue(self.owner)}'
        self.assertEqual(self.client.post(path, json.dumps({**data, 'decision_confirmed': False}),
            content_type='application/json', **headers).status_code, 400)
        other = Business.objects.create(name='Other disposition business')
        setup_business(other)
        self.assertEqual(self.client.post(path.replace(f'/{self.business.pk}/', f'/{other.pk}/', 1),
            json.dumps(data), content_type='application/json', **headers).status_code, 404)
        response = self.client.post(path, json.dumps(data), content_type='application/json', **headers)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self.client.post(path, json.dumps(data), content_type='application/json',
            **headers).json()['disposition_id'], response.json()['disposition_id'])

    def test_draft_cancellation_has_no_posting(self):
        draft = Sale.objects.create(business=self.business, invoice_number='DRAFT-1',
            customer=None, location=self.location,
            income_category=IncomeCategory.objects.filter(business=self.business).first(),
            actor=self.owner, command_id=uuid.uuid4(), mode='manual', price_tier='retail',
            status='draft', subtotal=Decimal('0'), total=Decimal('0'))
        command = uuid.uuid4()
        cancel_sale(draft, self.owner, command, 'Abandoned draft')
        self.assertEqual(cancel_sale(draft, self.owner, command, 'Abandoned draft').status, 'cancelled')
        self.assertFalse(JournalEntry.objects.filter(business=self.business,
            source_type='sale', source_id=str(draft.pk)).exists())
        self.assertFalse(StockMovement.objects.filter(reference_id=draft.pk).exists())
