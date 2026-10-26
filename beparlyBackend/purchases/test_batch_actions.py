import json
import uuid
from datetime import date
from decimal import Decimal
from io import BytesIO
from urllib.parse import urlencode

from django.test import TestCase
from pypdf import PdfReader

from accounting.models import JournalEntry, MoneyAccount
from accounting.services import create_financial_category, setup_business
from accounts.models import AuthSession, Business, BusinessMember, User
from audit.models import AuditEvent
from products.models import Product
from sales.services import create_sale
from stockkeeper.models import StockLocation, StockMovement
from stockkeeper.services import receive

from .services import complete_purchase, create_supplier, save_draft


class BatchActionTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        self.staff = User.objects.create_user(phone='01812345678', password='StaffPass#83')
        self.business = Business.objects.create(name='Batch Shop')
        BusinessMember.objects.create(user=self.owner, business=self.business, role='owner')
        BusinessMember.objects.create(user=self.staff, business=self.business, role='employee',
                                      can_post_stock=False, can_manage_purchases=False)
        setup_business(self.business)
        self.location = StockLocation.objects.get(business=self.business, is_default=True)
        self.location.address = 'Dhaka shop'
        self.location.save(update_fields=['address'])
        self.cash = MoneyAccount.objects.get(business=self.business, is_default=True)
        self.category = create_financial_category(self.business, self.owner, 'Sales', 'income')
        self.product = Product.objects.create(business=self.business, name='Rice', sku='RICE',
            purchase_price=Decimal('4'), retail_price=Decimal('10'))
        receive(self.product, self.location, Decimal('100'), Decimal('4'), self.owner, uuid.uuid4())
        self.supplier = create_supplier(self.business, self.owner, {'name': 'Supplier'}, uuid.uuid4())
        self.auth = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(self.owner)}'}
        self.staff_auth = {'HTTP_AUTHORIZATION': f'Bearer {AuthSession.issue(self.staff)}'}
        self.sales_path = f'/api/v1/businesses/{self.business.pk}/sales/batch/'
        self.purchases_path = f'/api/v1/businesses/{self.business.pk}/purchases/batch/'

    def sale(self, line_count=1):
        return create_sale(self.business, self.owner, uuid.uuid4(), {
            'mode': 'manual', 'price_tier': 'retail', 'location_id': self.location.pk,
            'income_category_id': self.category.pk, 'paid': str(line_count * 10), 'account_id': str(self.cash.pk),
            'lines': [{'product_id': str(self.product.pk), 'quantity': '1'} for _ in range(line_count)]})

    def purchase(self, completed=True):
        row = save_draft(self.business, self.owner, uuid.uuid4(), {
            'supplier_id': str(self.supplier.pk), 'location_id': self.location.pk,
            'notes': 'Original delivery note',
            'lines': [{'product_id': str(self.product.pk), 'quantity': '2', 'unit_cost': '4'}]})
        if completed:
            complete_purchase(row, self.owner, uuid.uuid4(), '0', None, date(2026, 11, 30))
            row.refresh_from_db()
        return row

    def document(self, path, ids, kind):
        return self.client.get(path + f"documents/{kind}/?{urlencode([('id', str(pk)) for pk in ids])}", **self.auth)

    def note(self, path, ids, text, command, auth=None):
        return self.client.post(path + 'notes/', data=json.dumps({'ids': [str(pk) for pk in ids], 'note': text}),
            content_type='application/json', HTTP_X_COMMAND_ID=str(command), **(auth or self.auth))

    def test_sale_invoice_and_label_preserve_order_and_reject_ineligible_records(self):
        first, second = self.sale(), self.sale()
        for kind in ('invoice', 'label'):
            response = self.document(self.sales_path, [second.pk, first.pk], kind)
            self.assertEqual(response.status_code, 200, response.content[:400])
            pages = PdfReader(BytesIO(response.content)).pages
            text = '\n'.join(page.extract_text() for page in pages)
            self.assertLess(text.index(second.invoice_number), text.index(first.invoice_number))
        draft = self.purchase(completed=False)
        response = self.document(self.purchases_path, [draft.pk], 'summary')
        self.assertEqual(response.status_code, 400)
        self.assertIn('draft', response.json()['error']['message'])
        self.assertEqual(self.document(self.sales_path, [uuid.uuid4() for _ in range(26)], 'invoice').status_code, 400)
        first.status = 'cancelled'
        first.save(update_fields=['status'])
        self.assertIn('cancelled', self.document(self.sales_path, [first.pk], 'invoice').json()['error']['message'])

    def test_batch_merges_all_pages_of_a_long_invoice_and_label(self):
        long_sale, short_sale = self.sale(65), self.sale()
        for kind in ('invoice', 'label'):
            first = self.document(self.sales_path, [long_sale.pk], kind)
            second = self.document(self.sales_path, [short_sale.pk], kind)
            combined = self.document(self.sales_path, [long_sale.pk, short_sale.pk], kind)
            self.assertEqual(combined.status_code, 200, combined.content[:400])
            self.assertEqual(len(PdfReader(BytesIO(combined.content)).pages),
                             len(PdfReader(BytesIO(first.content)).pages) + len(PdfReader(BytesIO(second.content)).pages))

    def test_purchase_summaries_include_lines_and_internal_notice(self):
        first, second = self.purchase(), self.purchase()
        response = self.document(self.purchases_path, [second.pk, first.pk], 'summary')
        self.assertEqual(response.status_code, 200, response.content[:400])
        pages = PdfReader(BytesIO(response.content)).pages
        self.assertEqual(len(pages), 2)
        text = '\n'.join(page.extract_text() for page in pages)
        self.assertLess(text.index(second.number), text.index(first.number))
        self.assertIn('not a supplier-issued invoice', text)
        self.assertIn('Rice', text)
        self.assertIn('Original delivery note', text)

    def test_notes_are_atomic_idempotent_attributed_and_do_not_post_money_or_stock(self):
        first, second = self.purchase(), self.purchase()
        command = uuid.uuid4()
        before = (StockMovement.objects.count(), JournalEntry.objects.count())
        response = self.note(self.purchases_path, [second.pk, first.pk], 'Checked by owner', command)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([row['record_id'] for row in response.json()['notes']], [str(second.pk), str(first.pk)])
        self.assertEqual(self.note(self.purchases_path, [second.pk, first.pk], 'Checked by owner', command).status_code, 200)
        self.assertEqual(self.note(self.purchases_path, [second.pk, first.pk], 'Changed', command).status_code, 400)
        events = AuditEvent.objects.filter(business=self.business, action='note_added', reference_id=command)
        self.assertEqual(events.count(), 2)
        self.assertTrue(all(item.actor_id == self.owner.pk and item.created_at for item in events))
        self.assertEqual(before, (StockMovement.objects.count(), JournalEntry.objects.count()))
        self.assertEqual(first.notes, 'Original delivery note')
        detail = self.client.get(f'/api/v1/businesses/{self.business.pk}/purchases/{first.pk}/', **self.auth)
        self.assertEqual(detail.json()['purchase']['added_notes'][0]['text'], 'Checked by owner')
        sale = self.sale()
        before = (StockMovement.objects.count(), JournalEntry.objects.count())
        response = self.note(self.sales_path, [sale.pk], 'Call buyer', uuid.uuid4())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((StockMovement.objects.count(), JournalEntry.objects.count()), before)
        detail = self.client.get(f'/api/v1/businesses/{self.business.pk}/sales/{sale.pk}/payments/', **self.auth)
        self.assertEqual(detail.json()['sale']['added_notes'][0]['text'], 'Call buyer')

    def test_missing_cross_business_and_unauthorized_notes_write_nothing(self):
        row = self.sale()
        other = Business.objects.create(name='Other')
        foreign = self.sale()
        foreign.business = other
        foreign.save(update_fields=['business'])
        count = AuditEvent.objects.filter(action='note_added').count()
        self.assertEqual(self.note(self.sales_path, [row.pk, foreign.pk], 'No', uuid.uuid4()).status_code, 400)
        self.assertEqual(self.note(self.sales_path, [row.pk, uuid.uuid4()], 'No', uuid.uuid4()).status_code, 400)
        self.assertEqual(self.note(self.sales_path, [row.pk], 'No', uuid.uuid4(), self.staff_auth).status_code, 403)
        self.assertEqual(self.document(self.sales_path, [foreign.pk], 'invoice').status_code, 400)
        purchase = self.purchase()
        self.assertEqual(self.note(self.purchases_path, [purchase.pk], 'No', uuid.uuid4(), self.staff_auth).status_code, 403)
        self.assertEqual(self.client.get(self.purchases_path + f'documents/summary/?id={purchase.pk}',
                                         **self.staff_auth).status_code, 403)
        self.assertEqual(AuditEvent.objects.filter(action='note_added').count(), count)
