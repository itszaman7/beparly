import uuid
from decimal import Decimal

from django.test import TestCase

from accounting.models import Contact, IncomeCategory, MoneyAccount
from accounting.services import balance, contact_position, create_financial_category, setup_business
from accounts.models import Business, BusinessMember, User
from products.models import Product
from stockkeeper.models import StockBalance, StockLocation, StockMovement
from stockkeeper.services import receive

from .models import Sale, SalePayment
from .services import SaleError, cancel_sale, create_sale, collect_sale


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
            'lines': [{'product_id': str(self.product.pk), 'quantity': '2'}]}
        data.update(changes)
        return data

    def test_sale_posts_stock_revenue_cogs_and_receipt_atomically_and_is_idempotent(self):
        command = uuid.uuid4()
        sale = create_sale(self.business, self.owner, command, self.payload())
        self.assertEqual(sale.total, Decimal('20.00'))
        self.assertEqual(sale.paid, Decimal('20.00'))
        self.assertEqual(sale.payment_status, 'paid')
        self.assertEqual(sale.lines.get().inventory_cost, Decimal('8.0000000'))
        self.assertEqual(SalePayment.objects.filter(sale=sale).count(), 1)
        self.assertEqual(StockMovement.objects.filter(reference_id=sale.pk, type='sale').count(), 1)
        self.assertEqual(create_sale(self.business, self.owner, command, self.payload()).pk, sale.pk)

    def test_credit_requires_customer_and_collection_clears_due(self):
        customer = Contact.objects.create(business=self.business, name='Karim', is_customer=True)
        sale = create_sale(self.business, self.owner, uuid.uuid4(), self.payload(customer_id=str(customer.pk), paid='5.00'))
        self.assertEqual(sale.total - sale.paid, Decimal('15.00'))
        self.assertEqual(Decimal(contact_position(customer)['to_collect']), Decimal('15'))
        collect_sale(sale, self.owner, uuid.uuid4(), '15.00', self.cash)
        sale.refresh_from_db()
        self.assertEqual(sale.payment_status, 'paid')
        self.assertEqual(Decimal(contact_position(customer)['to_collect']), Decimal('0'))

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
