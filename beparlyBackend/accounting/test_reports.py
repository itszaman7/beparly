from datetime import date
from decimal import Decimal

from django.test import TestCase

from accounts.models import AuthSession, Business, BusinessMember, User
from .models import MoneyAccount
from .services import cr, dr, ledger, post, setup_business
from products.models import Product, StockBatch
from stockkeeper.models import StockLocation
from stockkeeper.services import receive, business_today, post_transfer, post_waste
from uuid import uuid4


class FinancialSummaryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        self.business = Business.objects.create(name='Report Shop')
        BusinessMember.objects.create(user=self.user, business=self.business, role=BusinessMember.OWNER)
        setup_business(self.business)
        self.cash = MoneyAccount.objects.get(business=self.business, is_default=True).ledger_account
        self.path = f'/api/v1/businesses/{self.business.pk}/reports/financial-summary/'
        self.headers = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(self.user)}'}

    def report(self, query='start_date=2026-01-01&end_date=2026-02-02&group_by=month'):
        response = self.client.get(f'{self.path}?{query}', **self.headers)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_monthly_income_cost_and_expense_breakdown(self):
        opening = ledger(self.business, 'OPENING')
        ar = ledger(self.business, 'AR')
        sales = ledger(self.business, 'SALES')
        cogs = ledger(self.business, 'COGS')
        inventory = ledger(self.business, 'INVENTORY')
        expense = ledger(self.business, 'OPERATING_EXPENSE')
        post(self.business, 'opening', '1', 'Opening cash', [dr(self.cash, 500), cr(opening, 500)], event_date=date(2026, 1, 1))
        post(self.business, 'sale', '1', 'Credit sale', [dr(ar, 100), cr(sales, 100), dr(cogs, 60), cr(inventory, 60)], event_date=date(2026, 1, 31))
        post(self.business, 'collection', '1', 'Old due', [dr(self.cash, 100), cr(ar, 100)], event_date=date(2026, 2, 1))
        post(self.business, 'purchase_payment', '1', 'Supplier paid', [dr(ledger(self.business, 'AP'), 20), cr(self.cash, 20)], event_date=date(2026, 2, 1))
        post(self.business, 'expense', '1', 'Rent', [dr(expense, 15), cr(self.cash, 15)], event_date=date(2026, 2, 2))
        result = self.report()
        self.assertEqual([row['period'] for row in result['rows']], ['2026-01-01', '2026-02-01'])
        self.assertEqual(result['rows'][0]['profit_loss'], '40')
        self.assertEqual(result['rows'][1]['income'], '0')
        self.assertEqual(result['totals'], {'income': '100', 'product_cost': '60', 'other_expenses': '15', 'profit_loss': '25'})
        self.assertEqual(sum(Decimal(item['amount']) for item in result['breakdown']['income']), Decimal(result['totals']['income']))
        self.assertEqual(sum(Decimal(item['amount']) for item in result['breakdown']['expenses']), Decimal('75'))
        self.assertEqual({item['id'] for item in result['breakdown']['expenses']}, {'COGS', 'OPERATING_EXPENSE'})

    def test_daily_empty_period_and_dated_reversal(self):
        sale = post(self.business, 'sale', '2', 'Sale', [dr(self.cash, 40), cr(ledger(self.business, 'SALES'), 40),
            dr(ledger(self.business, 'COGS'), 10), cr(ledger(self.business, 'INVENTORY'), 10)], event_date=date(2026, 1, 10))
        post(self.business, 'reversal', sale.pk, 'Cancelled', [dr(ledger(self.business, 'SALES'), 40), cr(self.cash, 40),
            dr(ledger(self.business, 'INVENTORY'), 10), cr(ledger(self.business, 'COGS'), 10)],
             event_date=date(2026, 1, 12), reverses=sale)
        result = self.report('start_date=2026-01-10&end_date=2026-01-12&group_by=day')
        self.assertEqual([row['income'] for row in result['rows']], ['40', '0', '-40'])
        self.assertEqual([row['has_activity'] for row in result['rows']], [True, False, True])
        self.assertEqual([row['product_cost'] for row in result['rows']], ['10', '0', '-10'])
        self.assertEqual([row['profit_loss'] for row in result['rows']], ['30', '0', '-30'])
        self.assertEqual(result['totals']['profit_loss'], '0')
        monthly = self.report('start_date=2026-01-01&end_date=2026-01-31&group_by=month')
        self.assertEqual(monthly['rows'][0]['profit_loss'], '0')
        self.assertTrue(monthly['rows'][0]['has_activity'])
        yearly = self.report('start_date=2025-12-31&end_date=2026-01-31&group_by=year')
        self.assertEqual([row['period'] for row in yearly['rows']], ['2025-01-01', '2026-01-01'])
        empty = self.report('start_date=2026-02-10&end_date=2026-02-10&group_by=day')
        self.assertEqual(empty['rows'][0]['income'], '0')
        self.assertFalse(empty['rows'][0]['has_activity'])
        self.assertEqual(empty['breakdown'], {'income': [], 'expenses': []})

    def test_invalid_dates_and_access(self):
        for query in ('start_date=2026-02-01', 'start_date=bad&end_date=2026-02-01',
                      'start_date=2026-02-02&end_date=2026-02-01', 'group_by=week',
                      'start_date=2020-01-01&end_date=2031-01-01'):
            self.assertEqual(self.client.get(f'{self.path}?{query}', **self.headers).status_code, 400)
        other = Business.objects.create(name='Other Shop')
        self.assertEqual(self.client.get(f'/api/v1/businesses/{other.pk}/reports/financial-summary/', **self.headers).status_code, 404)
        employee = User.objects.create_user(phone='01712345679', password='EmployeePass#83')
        BusinessMember.objects.create(user=employee, business=self.business, role=BusinessMember.EMPLOYEE)
        employee_headers = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(employee)}'}
        self.assertEqual(self.client.get(self.path, **employee_headers).status_code, 403)
        self.assertEqual(self.client.get(self.path).status_code, 401)
        for name in ('sales-summary', 'current-stock', 'customer-dues', 'trial-balance'):
            path = f'/api/v1/businesses/{self.business.pk}/reports/{name}/'
            self.assertEqual(self.client.get(path, **employee_headers).status_code, 403)
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(path.replace(f'/{self.business.pk}/', f'/{other.pk}/'), **self.headers).status_code, 404)

    def test_core_statement_and_activity_reports_reconcile(self):
        ar = ledger(self.business, 'AR')
        sales = ledger(self.business, 'SALES')
        post(self.business, 'sale', 'report-sale', 'Credit sale', [dr(ar, 120), cr(sales, 120)],
             event_date=date(2026, 1, 10))
        post(self.business, 'sale_collection', 'report-collection', 'Old due collected',
             [dr(self.cash, 20), cr(ar, 20)], event_date=date(2026, 2, 1))
        prefix = f'/api/v1/businesses/{self.business.pk}/reports/'
        def get(name, query):
            response = self.client.get(f'{prefix}{name}/?{query}', **self.headers)
            self.assertEqual(response.status_code, 200, response.content)
            return response.json()
        sales_report = get('sales-summary', 'start_date=2026-02-01&end_date=2026-02-28')
        self.assertEqual(sales_report['total'], '0')
        self.assertEqual(get('money-received', 'start_date=2026-02-01&end_date=2026-02-28')['total'], '20')
        trial = get('trial-balance', 'as_of=2026-02-28')
        self.assertTrue(trial['reconciled'])
        self.assertEqual(Decimal(trial['total_debit']), Decimal(trial['total_credit']))
        balance = get('balance-sheet', 'as_of=2026-02-28')
        self.assertTrue(balance['reconciled'])
        self.assertEqual(balance['current_earnings'], '120')
        ledger_result = get('general-ledger', 'start_date=2026-02-01&as_of=2026-02-28&account_code=AR')
        self.assertEqual(ledger_result['opening_balance'], '120')
        self.assertEqual(ledger_result['closing_balance'], '100')
        self.assertEqual(ledger_result['rows'][0]['source_id'], 'report-collection')
        self.assertEqual(get('profit-loss', 'start_date=2026-01-01&end_date=2026-02-28')['totals']['profit_loss'], '120')
        self.assertEqual(self.client.get(f'{prefix}trial-balance/?as_of=2026-02-28').status_code, 401)

    def test_money_received_excludes_opening_and_owner_capital(self):
        from .models import MoneyTransaction
        from .services import create_financial_category, money_operation
        from uuid import uuid4
        money = MoneyAccount.objects.get(business=self.business, is_default=True)
        money_operation(self.business, self.user, uuid4(), 'opening_balance', '100', money, allow_opening=True)
        money_operation(self.business, self.user, uuid4(), 'owner_contribution', '50', money)
        category = create_financial_category(self.business, self.user, 'Other receipts', 'income')
        money_operation(self.business, self.user, uuid4(), 'other_income', '20', money, income_category=category)
        self.assertEqual(MoneyTransaction.objects.filter(business=self.business).count(), 3)
        today = business_today(self.business).isoformat()
        response = self.client.get(f'/api/v1/businesses/{self.business.pk}/reports/money-received/'
            f'?start_date={today}&end_date={today}', **self.headers)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(Decimal(response.json()['total']), Decimal('20'))

    def test_general_ledger_pages_keep_full_totals_and_running_balance(self):
        ar = ledger(self.business, 'AR')
        sales = ledger(self.business, 'SALES')
        for index in range(51):
            post(self.business, 'sale', f'paged-{index}', 'Paged sale',
                 [dr(ar, 1), cr(sales, 1)], event_date=date(2026, 1, 10))
        root = f'/api/v1/businesses/{self.business.pk}/reports/general-ledger/'
        query = '?account_code=AR&start_date=2026-01-01&as_of=2026-01-31'
        first = self.client.get(root + query, **self.headers).json()
        second = self.client.get(root + query + '&page=2', **self.headers).json()
        self.assertEqual(first['next_page'], 2)
        self.assertEqual(len(first['rows']), 50)
        self.assertEqual(len(second['rows']), 1)
        self.assertEqual(first['closing_balance'], '51')
        self.assertEqual(second['closing_balance'], '51')
        self.assertEqual(Decimal(second['rows'][0]['running_balance']), Decimal('51'))

    def test_inventory_reports_use_base_quantity_and_current_fifo_cost(self):
        location = StockLocation.objects.get(business=self.business, is_default=True)
        product = Product.objects.create(business=self.business, name='Rice', sku='RICE',
                                         purchase_price=Decimal('4'), retail_price=Decimal('7'))
        receive(product, location, Decimal('3'), Decimal('4'), self.user, uuid4())
        prefix = f'/api/v1/businesses/{self.business.pk}/reports/'
        cutoff = business_today(self.business).isoformat()
        current = self.client.get(f'{prefix}current-stock/?as_of={cutoff}', **self.headers)
        self.assertEqual(current.status_code, 200, current.content)
        self.assertEqual(current.json()['total_quantity'], '3')
        valuation = self.client.get(f'{prefix}stock-valuation/?as_of={cutoff}', **self.headers)
        self.assertEqual(valuation.status_code, 200, valuation.content)
        self.assertEqual(Decimal(valuation.json()['value']), Decimal('12'))
        self.assertTrue(valuation.json()['reconciled'])
        old = self.client.get(f'{prefix}stock-valuation/?as_of=2020-01-01', **self.headers)
        self.assertFalse(old.json()['available'])
        other = Business.objects.create(name='Other')
        self.assertEqual(self.client.get(f'{prefix}current-stock/?as_of={cutoff}&location_id=999999', **self.headers).status_code, 400)
        self.assertEqual(self.client.get(f'/api/v1/businesses/{other.pk}/reports/current-stock/', **self.headers).status_code, 404)

    def test_report_destinations_return_valid_empty_states(self):
        prefix = f'/api/v1/businesses/{self.business.pk}/reports/'
        cutoff = business_today(self.business).isoformat()
        for name in ('daily-sales', 'expenses', 'purchase-summary', 'stock-sold', 'best-sellers',
                     'wastage-loss', 'stock-movements'):
            response = self.client.get(f'{prefix}{name}/?start_date={cutoff}&end_date={cutoff}', **self.headers)
            self.assertEqual(response.status_code, 200, (name, response.content))
            self.assertEqual(response.json()['rows'], [])
        for name in ('expiry', 'current-stock', 'stock-valuation', 'customer-dues', 'supplier-dues'):
            response = self.client.get(f'{prefix}{name}/?as_of={cutoff}', **self.headers)
            self.assertEqual(response.status_code, 200, (name, response.content))
            self.assertEqual(response.json()['rows'], [])

    def test_transfer_keeps_business_value_and_expiry_separates_disposal(self):
        shop = StockLocation.objects.get(business=self.business, is_default=True)
        store = StockLocation.objects.create(business=self.business, name='Godown', type='warehouse')
        product = Product.objects.create(business=self.business, name='Milk', sku='MILK',
            tracking_mode='expiry', purchase_price=Decimal('5'), retail_price=Decimal('7'))
        batch = StockBatch.objects.create(product=product, variant=product.variants.get(),
                                          lot_code='OLD', expires_on='2026-01-01')
        receive(product, shop, Decimal('3'), Decimal('5'), self.user, uuid4(), batch=batch)
        post_transfer(product, shop, store, Decimal('2'), self.user, uuid4(), batch=batch)
        today = business_today(self.business).isoformat()
        prefix = f'/api/v1/businesses/{self.business.pk}/reports/'
        expiry = self.client.get(f'{prefix}expiry/?as_of={today}', **self.headers).json()
        self.assertEqual(expiry['expired_awaiting_disposal'], '3')
        self.assertEqual(expiry['recognized_write_off_quantity'], '0')
        post_waste(product, store, Decimal('1'), self.user, uuid4(), 'Expired', batch=batch)
        expiry = self.client.get(f'{prefix}expiry/?as_of={today}', **self.headers).json()
        self.assertEqual(expiry['expired_awaiting_disposal'], '2')
        self.assertEqual(expiry['recognized_write_off_quantity'], '1')
        valuation = self.client.get(f'{prefix}stock-valuation/?as_of={today}', **self.headers).json()
        self.assertEqual(Decimal(valuation['value']), Decimal('10'))
        self.assertTrue(valuation['reconciled'])
        inventory = self.client.get(f'{prefix}stock-movements/?start_date={today}&end_date={today}', **self.headers).json()
        self.assertEqual(Decimal(inventory['total_quantity']), Decimal('2'))
