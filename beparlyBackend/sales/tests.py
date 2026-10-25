import uuid
import json
from decimal import Decimal

from django.test import TestCase

from accounting.models import Contact, DueDateChange, IncomeCategory, MoneyAccount
from accounting.due_views import effective_date
from accounts.models import AuthSession
from datetime import date
from accounting.services import balance, contact_position, create_financial_category, setup_business
from accounts.models import Business, BusinessMember, User
from products.models import Product
from stockkeeper.models import StockBalance, StockLocation, StockMovement
from stockkeeper.services import receive

from .models import Sale, SalePayment, SaleReturn
from .services import SaleError, cancel_sale, create_sale, collect_sale, return_sale, serialize_sale


class SalePostingTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        self.business = Business.objects.create(name='Sales Test')
        BusinessMember.objects.create(user=self.owner, business=self.business, role=BusinessMember.OWNER)
        setup_business(self.business)
        self.location = StockLocation.objects.get(business=self.business, is_default=True)
        self.location.address = 'Main Shop, Dhaka'
        self.location.save(update_fields=['address'])
        self.cash = MoneyAccount.objects.get(business=self.business, is_default=True)
        self.category = create_financial_category(self.business, self.owner, 'Sales', 'income')
        self.product = Product.objects.create(business=self.business, name='Soap', sku='SOAP-1', base_unit='Piece',
            retail_price=Decimal('10.00'), wholesale_price=Decimal('8.00'), purchase_price=Decimal('4.00'))
        receive(self.product, self.location, Decimal('10'), Decimal('4'), self.owner, uuid.uuid4())

    def payload(self, **changes):
        data = {'mode': 'manual', 'price_tier': 'retail', 'location_id': self.location.pk,
            'income_category_id': self.category.pk, 'paid': '20.00', 'account_id': str(self.cash.pk),
            'due_date': '2026-11-30',
            'lines': [{'product_id': str(self.product.pk), 'quantity': '2'}]}
        data.update(changes)
        return data

    def test_sale_posts_stock_revenue_cogs_and_receipt_atomically_and_is_idempotent(self):
        command = uuid.uuid4()
        sale = create_sale(self.business, self.owner, command, self.payload())
        self.assertEqual(sale.invoice_number, 'S-001')
        self.assertEqual(sale.total, Decimal('20.00'))
        self.assertEqual(sale.paid, Decimal('20.00'))
        self.assertEqual(sale.payment_status, 'paid')
        self.assertEqual(sale.lines.get().inventory_cost, Decimal('8.0000000'))
        self.assertEqual(SalePayment.objects.filter(sale=sale).count(), 1)
        self.assertEqual(StockMovement.objects.filter(reference_id=sale.pk, type='sale').count(), 1)
        self.assertEqual(create_sale(self.business, self.owner, command, self.payload()).pk, sale.pk)

    def test_stock_sold_and_best_sellers_use_base_units_and_recorded_cost(self):
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload())
        from stockkeeper.services import business_today
        from accounts.models import AuthSession
        today = business_today(self.business).isoformat()
        auth = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(self.owner)}'}
        root = f'/api/v1/businesses/{self.business.pk}/reports/'
        sold = self.client.get(f'{root}stock-sold/?start_date={today}&end_date={today}', **auth)
        self.assertEqual(sold.status_code, 200, sold.content)
        self.assertEqual(Decimal(sold.json()['total_quantity']), Decimal('-2'))
        self.assertEqual(Decimal(sold.json()['total_cost']), Decimal('-8'))
        best = self.client.get(f'{root}best-sellers/?start_date={today}&end_date={today}', **auth)
        self.assertEqual(best.status_code, 200, best.content)
        self.assertEqual(best.json()['rows'][0]['product_id'], str(self.product.pk))
        self.assertEqual(Decimal(best.json()['rows'][0]['quantity']), Decimal('2'))
        self.assertEqual(Decimal(best.json()['rows'][0]['cost']), Decimal('8'))
        self.assertEqual(sold.json()['rows'][0]['sale_id'], str(sale.pk))
        self.assertEqual(sold.json()['rows'][0]['products'][0]['name'], 'Soap')

    def test_report_sales_drilldown_includes_customer_products_and_scopes_business(self):
        customer = Contact.objects.create(business=self.business, name='Karim', phone='01712345679', is_customer=True)
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(customer_id=str(customer.pk)))
        from stockkeeper.services import business_today
        today = business_today(self.business).isoformat()
        auth = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(self.owner)}'}
        path = f'/api/v1/businesses/{self.business.pk}/reports/sales/?start_date={today}&end_date={today}'
        response = self.client.get(path, **auth)
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()['rows'][0]
        self.assertEqual((row['sale_id'], row['sale_number'], row['customer_name']),
                         (str(sale.pk), sale.invoice_number, 'Karim'))
        self.assertEqual(row['products'][0]['name'], 'Soap')
        self.assertEqual(Decimal(row['products'][0]['quantity']), Decimal('2'))
        sales_summary = self.client.get(f'/api/v1/businesses/{self.business.pk}/reports/sales-summary/'
            f'?start_date={today}&end_date={today}', **auth).json()
        self.assertEqual(sales_summary['rows'][0]['sale_id'], str(sale.pk))
        self.assertEqual(sales_summary['rows'][0]['customer_name'], 'Karim')
        money_received = self.client.get(f'/api/v1/businesses/{self.business.pk}/reports/money-received/'
            f'?start_date={today}&end_date={today}', **auth).json()
        self.assertEqual(money_received['rows'][0]['sale_id'], str(sale.pk))
        self.assertEqual(self.client.get(path + f'&product_id={self.product.pk}', **auth).json()['rows'][0]['sale_id'], str(sale.pk))
        self.assertEqual(self.client.get(path + '&product_id=00000000-0000-0000-0000-000000000000', **auth).json()['rows'], [])
        self.assertEqual(self.client.get(path + '&product_id=bad-id', **auth).status_code, 400)
        self.assertEqual(self.client.get(path + '&location_id=bad-id', **auth).status_code, 400)
        self.assertEqual(self.client.get(path).status_code, 401)
        other = Business.objects.create(name='Other')
        self.assertEqual(self.client.get(path.replace(f'/{self.business.pk}/', f'/{other.pk}/'), **auth).status_code, 404)

    def test_credit_requires_customer_and_collection_clears_due(self):
        customer = Contact.objects.create(business=self.business, name='Karim', is_customer=True)
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(customer_id=str(customer.pk), paid='5.00'))
        self.assertEqual(sale.total - sale.paid, Decimal('15.00'))
        self.assertEqual(Decimal(contact_position(customer)['to_collect']), Decimal('15'))
        collect_sale(sale, self.owner, uuid.uuid4(), '15.00', self.cash)
        sale.refresh_from_db()
        self.assertEqual(sale.payment_status, 'paid')
        self.assertEqual(Decimal(contact_position(customer)['to_collect']), Decimal('0'))

    def test_credit_due_date_aging_and_owner_rescheduling(self):
        customer = Contact.objects.create(business=self.business, name='Due buyer', phone='01712345679', is_customer=True)
        with self.assertRaisesMessage(SaleError, 'due date'):
            create_sale(self.business, self.owner, uuid.uuid4(), self.payload(customer_id=str(customer.pk), paid='0', due_date=None))
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            customer_id=str(customer.pk), paid='5.00', due_date='2026-10-20'))
        auth = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(self.owner)}'}
        root = f'/api/v1/businesses/{self.business.pk}/'
        report = self.client.get(root + 'reports/customer-dues/?as_of=2026-10-25', **auth)
        self.assertEqual(report.status_code, 200, report.content)
        self.assertEqual(report.json()['buckets']['overdue'], '15.00')
        command_id = str(uuid.uuid4())
        route = root + f'dues/sale/{sale.pk}/reschedule/'
        payload = json.dumps({'due_date': '2026-11-30', 'reason': 'Agreed extension'})
        response = self.client.post(route, data=payload, content_type='application/json',
            HTTP_X_COMMAND_ID=command_id, **auth)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.client.post(route, data=payload, content_type='application/json',
            HTTP_X_COMMAND_ID=command_id, **auth).json()['change_id'], response.json()['change_id'])
        self.assertEqual(DueDateChange.objects.filter(sale=sale).count(), 1)
        self.assertEqual(effective_date(sale, date(2026, 10, 24), 'sale'), date(2026, 10, 20))
        self.assertEqual(effective_date(sale, date(2026, 10, 25), 'sale'), date(2026, 11, 30))
        report = self.client.get(root + 'reports/customer-dues/?as_of=2026-10-25', **auth).json()
        self.assertEqual(report['buckets']['overdue'], '0')
        self.assertEqual(report['buckets']['upcoming'], '15.00')

    def test_sales_list_filters_to_selected_customer(self):
        first = Contact.objects.create(business=self.business, name='First buyer', is_customer=True)
        second = Contact.objects.create(business=self.business, name='Second buyer', is_customer=True)
        expected = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(customer_id=str(first.pk)))
        create_sale(self.business, self.owner, uuid.uuid4(), self.payload(customer_id=str(second.pk)))
        login = self.client.post('/api/v1/auth/login/', data=json.dumps(
            {'phone': self.owner.phone, 'password': 'OwnerPass#83'}), content_type='application/json')
        path = f'/api/v1/businesses/{self.business.pk}/sales/?customer_id={first.pk}'
        response = self.client.get(path, HTTP_AUTHORIZATION=f"Bearer {login.json()['token']}")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([row['id'] for row in response.json()['sales']], [str(expected.pk)])

    def test_sales_label_requires_business_access(self):
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload())
        path = f'/api/v1/businesses/{self.business.pk}/sales/{sale.pk}/documents/label/'
        self.assertEqual(self.client.get(path).status_code, 401)
        login = self.client.post('/api/v1/auth/login/', data=json.dumps(
            {'phone': self.owner.phone, 'password': 'OwnerPass#83'}), content_type='application/json')
        auth = {'HTTP_AUTHORIZATION': f"Bearer {login.json()['token']}"}
        response = self.client.get(path, **auth)
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertTrue(response.content.startswith(b'%PDF-'))
        other = Business.objects.create(name='Another shop')
        BusinessMember.objects.create(user=self.owner, business=other, role=BusinessMember.OWNER)
        self.assertEqual(self.client.get(path.replace(f'/{self.business.pk}/', f'/{other.pk}/'), **auth).status_code, 404)

    def test_checkout_rejects_guest_due_and_rolls_back_stock(self):
        with self.assertRaises(SaleError):
            create_sale(self.business, self.owner, uuid.uuid4(), self.payload(paid='0'))
        self.assertFalse(Sale.objects.exists())
        self.assertFalse(StockMovement.objects.filter(type='sale').exists())

    def test_wholesale_walk_in_is_paid_and_keeps_checkout_metadata(self):
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            mode='manual', price_tier='wholesale', income_category_id=None, paid='16.00',
            billing_address={'text': 'Billing'}, delivery_address={'text': 'Delivery'},
            source='Phone order', notes='Leave at front desk', invoice_date='2026-10-22'))
        self.assertEqual(sale.customer.name, 'Walk-in Customer')
        self.assertEqual(sale.price_tier, 'wholesale')
        self.assertEqual(sale.payment_status, 'paid')
        self.assertEqual(sale.billing_address, {'text': 'Main Shop, Dhaka', 'location_id': str(self.location.pk)})
        self.assertEqual(sale.invoice_date.isoformat(), '2026-10-22')

    def test_registered_customer_can_buy_at_retail_tier_and_leave_due(self):
        customer = Contact.objects.create(business=self.business, name='Retail buyer', phone='01712345679', is_customer=True)
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            customer_id=str(customer.pk), mode='quick', price_tier='retail', paid='0'))
        self.assertEqual(sale.customer_id, customer.pk)
        self.assertEqual(sale.price_tier, 'retail')
        self.assertEqual(sale.payment_status, 'due')

    def test_sale_keeps_customer_snapshot_after_contact_changes(self):
        customer = Contact.objects.create(business=self.business, name='Original buyer', phone='01712345679',
                                           address='Old address', district='Dhaka', is_customer=True)
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            customer_id=str(customer.pk), mode='quick', price_tier='retail', paid='0'))
        customer.name = 'Updated buyer'
        customer.phone = '01712345670'
        customer.address = 'New address'
        customer.save(update_fields=['name', 'phone', 'address'])
        sale.refresh_from_db()
        self.assertEqual(sale.customer_name_snapshot, 'Original buyer')
        self.assertEqual(sale.customer_phone_snapshot, '01712345679')
        self.assertEqual(sale.customer_address_snapshot['address'], 'Old address')

    def test_sale_creates_default_sales_income_category_when_business_has_none(self):
        IncomeCategory.objects.filter(business=self.business).delete()
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload())
        self.assertEqual(sale.income_category.name, 'Sales')
        self.assertEqual(sale.income_category.ledger_account.type, 'income')

    def test_sale_does_not_use_miscellaneous_income_category(self):
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload())
        self.assertEqual(sale.income_category.name, 'Sales')
        miscellaneous = IncomeCategory.objects.get(business=self.business, name='Miscellaneous income')
        with self.assertRaises(SaleError):
            create_sale(self.business, self.owner, uuid.uuid4(), {**self.payload(), 'income_category_id': miscellaneous.pk})

    def test_cancellation_restores_stock_fifo_value_and_refunds_original_account(self):
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload())
        self.assertEqual(balance(self.cash.ledger_account), Decimal('20'))
        command = uuid.uuid4()
        cancel_sale(sale, self.owner, command, 'Entered incorrectly')
        sale.refresh_from_db()
        self.assertEqual(sale.status, 'cancelled')
        self.assertEqual(StockBalance.objects.get(variant=self.product.variants.get(), location=self.location).quantity, Decimal('10'))
        self.assertEqual(balance(self.cash.ledger_account), Decimal('0'))
        self.assertEqual(StockMovement.objects.filter(reference_id=sale.pk).count(), 2)
        self.assertEqual(cancel_sale(sale, self.owner, command, 'Entered incorrectly').pk, sale.pk)

    def test_delivery_charge_posts_separately_and_requires_address(self):
        with self.assertRaises(SaleError):
            create_sale(self.business, self.owner, uuid.uuid4(), self.payload(delivery_fee='5.00', paid='25.00'))
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            delivery_fee='5.00', delivery_address='House 10, Dhaka', paid='25.00'))
        self.assertEqual(sale.total, Decimal('25.00'))
        self.assertEqual(sale.delivery_address, {'text': 'House 10, Dhaka'})
        self.assertEqual(balance(sale.business.ledgeraccount_set.get(code='DELIVERY_INCOME')), Decimal('-5'))
        self.assertEqual(serialize_sale(sale)['delivery_fee'], '5.00')

    def test_partial_return_reduces_due_then_refunds_and_restocks_only_sellable(self):
        customer = Contact.objects.create(business=self.business, name='Return buyer', is_customer=True)
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            customer_id=str(customer.pk), paid='15.00', delivery_fee='5.00', delivery_address='Dhaka'))
        line = sale.lines.get()
        first = return_sale(sale, self.owner, uuid.uuid4(), {'reason': 'Wrong size',
            'lines': [{'line_id': line.pk, 'quantity': '1', 'condition': 'sellable'}]})
        sale.refresh_from_db()
        self.assertEqual(first.amount, Decimal('10.00'))
        self.assertEqual(first.due_reduction, Decimal('10.00'))
        self.assertEqual(first.refund_amount, Decimal('0.00'))
        self.assertEqual(serialize_sale(sale)['due'], '0.00')
        self.assertEqual(Decimal(contact_position(customer)['to_collect']), Decimal('0'))
        self.assertEqual(StockBalance.objects.get(variant=line.variant, location=self.location).quantity, Decimal('9'))
        command = uuid.uuid4()
        second = return_sale(sale, self.owner, command, {'reason': 'Damaged', 'refund_account_id': str(self.cash.pk),
            'lines': [{'line_id': line.pk, 'quantity': '1', 'condition': 'damaged'}]})
        self.assertEqual(return_sale(sale, self.owner, command, {}) .pk, second.pk)
        sale.refresh_from_db()
        self.assertEqual(second.refund_amount, Decimal('10.00'))
        self.assertEqual(sale.paid, Decimal('5.00'))
        self.assertEqual(serialize_sale(sale)['net_total'], '5.00')
        self.assertEqual(balance(self.cash.ledger_account), Decimal('5'))
        self.assertEqual(Decimal(contact_position(customer)['to_collect']), Decimal('0'))
        self.assertEqual(balance(self.business.ledgeraccount_set.get(code='INVENTORY_LOSS')), Decimal('4'))
        self.assertEqual(serialize_sale(sale)['profit'], '1.0000000')
        self.assertEqual(StockBalance.objects.get(variant=line.variant, location=self.location).quantity, Decimal('9'))
        self.assertEqual(SaleReturn.objects.filter(sale=sale).count(), 2)
        from accounting.sale_reports import entry_sale_ids
        related = entry_sale_ids(self.business, [first.journal, second.journal, second.refund_journal])
        self.assertEqual(set(related.values()), {str(sale.pk)})
        self.assertEqual(len(related), 3)
        with self.assertRaises(SaleError):
            cancel_sale(sale, self.owner, uuid.uuid4(), 'Too late')

    def test_return_rejects_overreturn_and_other_business_refund_account(self):
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload())
        line = sale.lines.get()
        with self.assertRaises(SaleError):
            return_sale(sale, self.owner, uuid.uuid4(), {'reason': 'Invalid',
                'lines': [{'line_id': line.pk, 'quantity': '3', 'condition': 'sellable'}]})
        other = Business.objects.create(name='Other business')
        setup_business(other)
        other_cash = MoneyAccount.objects.get(business=other, is_default=True)
        with self.assertRaises(SaleError):
            return_sale(sale, self.owner, uuid.uuid4(), {'reason': 'Invalid account',
                'refund_account_id': str(other_cash.pk),
                'lines': [{'line_id': line.pk, 'quantity': '1', 'condition': 'sellable'}]})
        self.assertFalse(SaleReturn.objects.filter(sale=sale).exists())

    def test_return_rounding_across_three_partial_returns_reconciles(self):
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            lines=[{'product_id': str(self.product.pk), 'quantity': '3'}],
            discount='1.00', paid='29.00'))
        line = sale.lines.get()
        amounts = []
        for _ in range(3):
            row = return_sale(sale, self.owner, uuid.uuid4(), {'reason': 'Wrong item',
                'refund_account_id': str(self.cash.pk),
                'lines': [{'line_id': line.pk, 'quantity': '1', 'condition': 'sellable'}]})
            amounts.append(row.amount)
        sale.refresh_from_db()
        self.assertEqual(sum(amounts), Decimal('29.00'))
        self.assertEqual(sale.paid, Decimal('0'))
        self.assertEqual(balance(self.cash.ledger_account), Decimal('0'))
        self.assertEqual(StockBalance.objects.get(variant=line.variant, location=self.location).quantity, Decimal('10'))

    def test_return_api_requires_member_and_active_refund_account(self):
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload())
        line = sale.lines.get()
        path = f'/api/v1/businesses/{self.business.pk}/sales/{sale.pk}/returns/'
        payload = {'reason': 'Customer returned it', 'refund_account_id': str(self.cash.pk),
                   'lines': [{'line_id': line.pk, 'quantity': '1', 'condition': 'sellable'}]}
        command = str(uuid.uuid4())
        self.assertEqual(self.client.post(path, data=json.dumps(payload), content_type='application/json',
            HTTP_X_COMMAND_ID=command).status_code, 401)
        login = self.client.post('/api/v1/auth/login/', data=json.dumps(
            {'phone': self.owner.phone, 'password': 'OwnerPass#83'}), content_type='application/json')
        token = login.json()['token']
        self.cash.is_active = False
        self.cash.save(update_fields=['is_active'])
        rejected = self.client.post(path, data=json.dumps(payload), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_COMMAND_ID=command)
        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.cash.is_active = True
        self.cash.save(update_fields=['is_active'])
        posted = self.client.post(path, data=json.dumps(payload), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_COMMAND_ID=command)
        self.assertEqual(posted.status_code, 201, posted.content)
        replay = self.client.post(path, data=json.dumps(payload), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_COMMAND_ID=command)
        self.assertEqual(replay.json()['return_id'], posted.json()['return_id'])
        other = Business.objects.create(name='No membership')
        self.assertEqual(self.client.post(path.replace(str(self.business.pk), str(other.pk), 1),
            data=json.dumps(payload), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_COMMAND_ID=str(uuid.uuid4())).status_code, 404)

    def test_sales_hub_summary_counts_more_than_list_limit_and_scopes_access(self):
        from datetime import timedelta
        from stockkeeper.services import business_today

        today = business_today(self.business)
        rows = [Sale(business=self.business, location=self.location, income_category=self.category,
                     actor=self.owner, command_id=uuid.uuid4(), invoice_number=f'HUB-{index}',
                     mode='manual', price_tier='retail', status='completed', payment_status='partial',
                     subtotal=Decimal('10'), discount=Decimal('0'), total=Decimal('10'),
                     paid=Decimal('4'), invoice_date=today) for index in range(101)]
        rows.append(Sale(business=self.business, location=self.location, income_category=self.category,
                         actor=self.owner, command_id=uuid.uuid4(), invoice_number='HUB-OLD',
                         mode='manual', price_tier='retail', status='completed', subtotal=Decimal('20'),
                         discount=Decimal('0'), total=Decimal('20'), paid=Decimal('20'),
                         invoice_date=today - timedelta(days=8)))
        rows.append(Sale(business=self.business, location=self.location, income_category=self.category,
                         actor=self.owner, command_id=uuid.uuid4(), invoice_number='HUB-CANCELLED',
                         mode='manual', price_tier='retail', status='cancelled', subtotal=Decimal('50'),
                         discount=Decimal('0'), total=Decimal('50'), paid=Decimal('0'), invoice_date=today))
        Sale.objects.bulk_create(rows)
        path = f'/api/v1/businesses/{self.business.pk}/sales/hub-summary/'
        self.assertEqual(self.client.get(path).status_code, 401)
        token = AuthSession.issue(self.owner)
        response = self.client.get(path, HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['completed_sales'], 102)
        self.assertEqual(Decimal(data['collected_against_sales']), Decimal('424'))
        self.assertEqual(Decimal(data['customer_due']), Decimal('606'))
        self.assertEqual(len(data['last_seven_days']), 7)
        self.assertEqual(Decimal(data['last_seven_days'][-1]['amount']), Decimal('1010'))
        self.assertEqual(data['last_seven_days'][-1]['count'], 101)

        employee = User.objects.create_user(phone='01812345678', password='EmployeePass#89')
        member = BusinessMember.objects.create(user=employee, business=self.business,
                                               role=BusinessMember.EMPLOYEE, can_post_stock=False)
        staff_token = AuthSession.issue(employee)
        self.assertEqual(self.client.get(path, HTTP_AUTHORIZATION=f'Bearer {staff_token}').status_code, 403)
        member.can_post_stock = True
        member.save(update_fields=['can_post_stock'])
        self.assertEqual(self.client.get(path, HTTP_AUTHORIZATION=f'Bearer {staff_token}').status_code, 200)
        other = Business.objects.create(name='Private shop')
        self.assertEqual(self.client.get(path.replace(str(self.business.pk), str(other.pk), 1),
                                         HTTP_AUTHORIZATION=f'Bearer {staff_token}').status_code, 404)

    def test_sales_hub_summary_uses_net_sale_after_return(self):
        customer = Contact.objects.create(business=self.business, name='Return buyer', is_customer=True)
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            customer_id=str(customer.pk), paid='15.00', delivery_fee='5.00', delivery_address='Dhaka'))
        line = sale.lines.get()
        return_sale(sale, self.owner, uuid.uuid4(), {'reason': 'Wrong size',
            'lines': [{'line_id': line.pk, 'quantity': '1', 'condition': 'sellable'}]})
        token = AuthSession.issue(self.owner)
        response = self.client.get(f'/api/v1/businesses/{self.business.pk}/sales/hub-summary/',
                                   HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(result['completed_sales'], 1)
        self.assertEqual(Decimal(result['collected_against_sales']), Decimal('15'))
        self.assertEqual(Decimal(result['customer_due']), Decimal('0'))
        self.assertEqual(Decimal(result['last_seven_days'][-1]['amount']), Decimal('15'))
        self.assertEqual(result['last_seven_days'][-1]['count'], 1)

    def test_dashboard_activity_is_recent_posted_and_permission_scoped(self):
        from django.utils import timezone
        from purchases.models import Purchase

        customer = Contact.objects.create(business=self.business, name='Buyer', is_customer=True)
        supplier = Contact.objects.create(business=self.business, name='Supplier', is_supplier=True)
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(
            customer_id=str(customer.pk), paid='15.00', delivery_fee='5.00', delivery_address='Dhaka'))
        return_sale(sale, self.owner, uuid.uuid4(), {'reason': 'Wrong size',
            'lines': [{'line_id': sale.lines.get().pk, 'quantity': '1', 'condition': 'sellable'}]})
        Purchase.objects.create(business=self.business, supplier=supplier, location=self.location,
            supplier_name=supplier.name, location_name=self.location.name, number='PUR-1', status='completed',
            total=Decimal('33.00'), create_command_id=uuid.uuid4(), actor=self.owner, completed_at=timezone.now())
        path = f'/api/v1/businesses/{self.business.pk}/dashboard-activity/'
        self.assertEqual(self.client.get(path).status_code, 401)
        token = AuthSession.issue(self.owner)
        response = self.client.get(path, HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()['activity']
        self.assertEqual({row['kind'] for row in rows}, {'sale', 'purchase'})
        self.assertEqual(next(row['amount'] for row in rows if row['kind'] == 'sale'), '15.00')

        employee = User.objects.create_user(phone='01812345678', password='EmployeePass#89')
        member = BusinessMember.objects.create(user=employee, business=self.business,
            role=BusinessMember.EMPLOYEE, can_post_stock=True, can_manage_purchases=False)
        staff_token = AuthSession.issue(employee)
        staff = self.client.get(path, HTTP_AUTHORIZATION=f'Bearer {staff_token}')
        self.assertEqual([row['kind'] for row in staff.json()['activity']], ['sale'])
        member.can_post_stock = False
        member.can_manage_purchases = True
        member.save(update_fields=['can_post_stock', 'can_manage_purchases'])
        staff = self.client.get(path, HTTP_AUTHORIZATION=f'Bearer {staff_token}')
        self.assertEqual([row['kind'] for row in staff.json()['activity']], ['purchase'])
        other = Business.objects.create(name='Private shop')
        self.assertEqual(self.client.get(path.replace(str(self.business.pk), str(other.pk), 1),
                                         HTTP_AUTHORIZATION=f'Bearer {staff_token}').status_code, 404)
