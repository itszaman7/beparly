import json
import tempfile
import uuid
from decimal import Decimal
from io import BytesIO

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from accounting.models import Contact, JournalEntry, MoneyAccount
from accounting.services import contact_position, create_money_account, setup_business
from accounts.models import Business, BusinessMember, User
from audit.models import AuditEvent
from products.models import Product, StockBatch
from stockkeeper.models import CostLayer, StockBalance, StockLocation, StockMovement
from stockkeeper.services import consume, post_adjustment

from .models import OpeningPayable, Purchase, SupplierOperation
from .services import (PurchaseError, cancel_purchase, complete_purchase, create_supplier,
                       purchase_data, save_draft, supplier_operation)


class PurchaseTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(phone='01712345678', password='OwnerPass#83')
        self.staff = User.objects.create_user(phone='01812345678', password='StaffPass#83')
        self.business = Business.objects.create(name='Purchase Shop')
        BusinessMember.objects.create(user=self.owner, business=self.business, role='owner')
        self.staff_member = BusinessMember.objects.create(user=self.staff, business=self.business,
            role='employee', can_post_stock=True, can_manage_purchases=False)
        setup_business(self.business)
        self.location = StockLocation.objects.get(business=self.business, is_default=True)
        self.cash = MoneyAccount.objects.get(business=self.business, is_default=True)
        self.product = Product.objects.create(business=self.business, name='Rice', sku='RICE',
            purchase_price=Decimal('8'), retail_price=Decimal('12'))
        self.batch_product = Product.objects.create(business=self.business, name='Milk', sku='MILK',
            tracking_mode='expiry', purchase_price=Decimal('5'), retail_price=Decimal('7'))
        self.batch = StockBatch.objects.create(product=self.batch_product,
            variant=self.batch_product.variants.get(), lot_code='L1', expires_on='2027-12-01')
        self.supplier = create_supplier(self.business, self.owner, {'name': 'Supplier', 'phone': ''}, uuid.uuid4())

    def draft(self, lines=None):
        return save_draft(self.business, self.owner, uuid.uuid4(), {'supplier_id': str(self.supplier.pk),
            'location_id': self.location.pk, 'lines': lines or [
                {'product_id': str(self.product.pk), 'quantity': '2', 'unit_cost': '8.00'},
                {'product_id': str(self.batch_product.pk), 'quantity': '3', 'unit_cost': '5.00',
                 'batch_id': str(self.batch.pk)}]})

    def test_large_draft_keeps_stock_and_balances_unchanged(self):
        lines = [{'product_id': str(self.product.pk), 'quantity': '1', 'unit_cost': '8.00'} for _ in range(101)]
        purchase = self.draft(lines)
        self.assertEqual(purchase.lines.count(), 101)
        self.assertEqual(purchase.total, Decimal('808'))
        self.assertFalse(StockMovement.objects.filter(type='purchase').exists())
        self.assertEqual(Decimal(contact_position(self.supplier)['to_pay']), 0)

    def test_draft_details_include_variant_and_batch_for_cart_restore(self):
        self.product.image_key = 'products/example.webp'
        self.product.save(update_fields=['image_key'])
        rows = purchase_data(self.draft(), details=True)['lines']
        self.assertEqual(rows[0]['sku'], 'RICE')
        self.assertIn('products/example.webp', rows[0]['image_url'])
        self.assertEqual(rows[0]['base_unit'], 'Piece')
        self.assertEqual(rows[1]['tracking_mode'], 'expiry')
        self.assertEqual(rows[1]['lot_code'], 'L1')

    def test_draft_inactive_then_multi_line_purchase_reconciles_once(self):
        purchase = self.draft()
        self.assertEqual(StockMovement.objects.filter(type='purchase').count(), 0)
        self.assertEqual(Decimal(contact_position(self.supplier)['to_pay']), 0)
        command = uuid.uuid4()
        complete_purchase(purchase, self.owner, command, '10.00', self.cash)
        purchase.refresh_from_db()
        self.assertEqual(purchase.number, 'P-001')
        self.assertEqual((purchase.total, purchase.paid), (Decimal('31'), Decimal('10')))
        self.assertEqual(Decimal(contact_position(self.supplier)['to_pay']), Decimal('21'))
        self.assertEqual(StockMovement.objects.filter(reference_id=purchase.pk, type='purchase').count(), 2)
        self.assertEqual(JournalEntry.objects.filter(business=self.business, source_type='stock_movement',
            source_id__in=[str(line.movement_id) for line in purchase.lines.all()]).count(), 0)
        self.assertEqual(sum((layer.remaining_quantity * layer.unit_cost for layer in
            CostLayer.objects.filter(business=self.business)), Decimal('0')), Decimal('31'))
        self.assertEqual(complete_purchase(purchase, self.owner, command).pk, purchase.pk)
        self.assertEqual(SupplierOperation.objects.filter(purchase=purchase, kind='payment').count(), 1)
        self.assertTrue(AuditEvent.objects.filter(entity_type='purchase', action='completed', entity_id=str(purchase.pk)).exists())

    def test_opening_payable_advance_allocation_and_refunds(self):
        supplier = create_supplier(self.business, self.owner,
            {'name': 'Opening supplier', 'opening_payable': '100.00'}, uuid.uuid4())
        opening = OpeningPayable.objects.get(supplier=supplier)
        self.assertEqual(Decimal(contact_position(supplier)['to_pay']), Decimal('100'))
        self.assertEqual(JournalEntry.objects.get(source_type='supplier_opening', source_id=str(supplier.pk)).lines.count(), 2)
        supplier_operation(self.business, supplier, self.owner, uuid.uuid4(), 'advance', '40', account=self.cash)
        command = uuid.uuid4()
        supplier_operation(self.business, supplier, self.owner, command, 'apply_advance', '25', opening=opening)
        supplier_operation(self.business, supplier, self.owner, command, 'apply_advance', '25', opening=opening)
        self.assertEqual(Decimal(contact_position(supplier)['supplier_advance']), Decimal('15'))
        self.assertEqual(Decimal(contact_position(supplier)['to_pay']), Decimal('75'))
        supplier_operation(self.business, supplier, self.owner, uuid.uuid4(), 'payment', '20', opening=opening, account=self.cash)
        supplier_operation(self.business, supplier, self.owner, uuid.uuid4(), 'payment_refund', '20', opening=opening, account=self.cash)
        supplier_operation(self.business, supplier, self.owner, uuid.uuid4(), 'allocation_reversal', '25', opening=opening)
        self.assertEqual(Decimal(contact_position(supplier)['to_pay']), Decimal('100'))

    def test_cancel_requires_refund_and_unused_stock(self):
        purchase = self.draft()
        complete_purchase(purchase, self.owner, uuid.uuid4(), '5', self.cash)
        with self.assertRaises(PurchaseError):
            cancel_purchase(purchase, self.owner, uuid.uuid4(), 'Mistake')
        supplier_operation(self.business, self.supplier, self.owner, uuid.uuid4(), 'payment_refund',
            '5', purchase=purchase, account=self.cash)
        command = uuid.uuid4()
        cancel_purchase(purchase, self.owner, command, 'Mistake')
        self.assertEqual(cancel_purchase(purchase, self.owner, command, 'Mistake').status, 'cancelled')
        self.assertEqual(Decimal(contact_position(self.supplier)['to_pay']), 0)
        self.assertEqual(StockBalance.objects.get(product=self.product).quantity, 0)
        self.assertEqual(CostLayer.objects.filter(product=self.product, remaining_quantity__gt=0).count(), 0)
        self.assertEqual(StockMovement.objects.filter(reference_id=purchase.pk, type='purchase_cancellation').count(), 2)

    def test_consumed_purchase_layer_blocks_cancellation_without_partial_reversal(self):
        purchase = self.draft()
        complete_purchase(purchase, self.owner, uuid.uuid4())
        consume(self.product, self.product.variants.get(), self.location, Decimal('1'), None)
        with self.assertRaises(PurchaseError):
            cancel_purchase(purchase, self.owner, uuid.uuid4(), 'Supplier sent wrong goods')
        purchase.refresh_from_db()
        self.assertEqual(purchase.status, 'completed')
        self.assertEqual(Decimal(contact_position(self.supplier)['to_pay']), Decimal('31'))
        self.assertFalse(StockMovement.objects.filter(reference_id=purchase.pk, type='purchase_cancellation').exists())

    def test_rejects_overpayment_and_manual_adjustment_creates_no_purchase(self):
        purchase = self.draft()
        complete_purchase(purchase, self.owner, uuid.uuid4())
        with self.assertRaises(PurchaseError):
            supplier_operation(self.business, self.supplier, self.owner, uuid.uuid4(), 'payment',
                '32', purchase=purchase, account=self.cash)
        before = Purchase.objects.count()
        post_adjustment(self.product, self.location, Decimal('1'), True, self.owner,
            uuid.uuid4(), 'Count gain', unit_cost=Decimal('8'))
        self.assertEqual(Purchase.objects.count(), before)
        self.assertEqual(Contact.objects.filter(business=self.business, is_supplier=True).count(), 1)

    def test_tenant_and_permission_api(self):
        other = Business.objects.create(name='Other')
        BusinessMember.objects.create(user=self.owner, business=other, role='owner')
        path = f'/api/v1/businesses/{self.business.pk}/suppliers/'
        login = self.client.post('/api/v1/auth/login/', data=json.dumps({'phone': self.staff.phone,
            'password': 'StaffPass#83'}), content_type='application/json').json()
        headers = {'HTTP_AUTHORIZATION': f'Bearer {login["token"]}'}
        self.assertEqual(self.client.get(path, **headers).status_code, 403)
        self.staff_member.can_manage_purchases = True
        self.staff_member.save(update_fields=['can_manage_purchases'])
        self.assertEqual(self.client.get(path, **headers).status_code, 200)
        self.assertEqual(self.client.get(f'/api/v1/businesses/{other.pk}/suppliers/', **headers).status_code, 404)

    def test_purchase_payment_accounts_include_user_added_account_for_staff(self):
        wallet = create_money_account(self.business, 'Shop bKash', 'wallet')
        login = self.client.post('/api/v1/auth/login/', data=json.dumps({'phone': self.staff.phone,
            'password': 'StaffPass#83'}), content_type='application/json').json()
        auth = {'HTTP_AUTHORIZATION': f'Bearer {login["token"]}'}
        path = f'/api/v1/businesses/{self.business.pk}/purchases/payment-accounts/'
        self.assertEqual(self.client.get(path, **auth).status_code, 403)
        self.staff_member.can_manage_purchases = True
        self.staff_member.save(update_fields=['can_manage_purchases'])
        response = self.client.get(path, **auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual({row['id'] for row in response.json()['accounts']}, {str(self.cash.pk), str(wallet.pk)})
        self.assertTrue(all('balance' in row for row in response.json()['accounts']))
        purchase = self.draft()
        posted = self.client.post(
            f'/api/v1/businesses/{self.business.pk}/purchases/{purchase.pk}/complete/',
            data=json.dumps({'paid': '10.00', 'account_id': str(wallet.pk)}),
            content_type='application/json', HTTP_X_COMMAND_ID=str(uuid.uuid4()), **auth)
        self.assertEqual(posted.status_code, 200, posted.content)
        self.assertEqual(SupplierOperation.objects.get(purchase=purchase, kind='payment').account_id, wallet.pk)
        other = Business.objects.create(name='Different shop')
        self.assertEqual(self.client.get(f'/api/v1/businesses/{other.pk}/purchases/payment-accounts/', **auth).status_code, 404)

    def test_supplier_photo_validated_and_tenant_scoped(self):
        login = self.client.post('/api/v1/auth/login/', data=json.dumps({'phone': self.owner.phone,
            'password': 'OwnerPass#83'}), content_type='application/json').json()
        auth = {'HTTP_AUTHORIZATION': f'Bearer {login["token"]}'}
        path = f'/api/v1/businesses/{self.business.pk}/suppliers/{self.supplier.pk}/image/'
        bad = self.client.post(path, {'image': SimpleUploadedFile('wrong.jpg', b'not an image')}, **auth)
        self.assertEqual(bad.status_code, 400)
        buffer = BytesIO()
        Image.new('RGB', (16, 16), 'red').save(buffer, format='PNG')
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            response = self.client.post(path, {'image': SimpleUploadedFile('photo.png', buffer.getvalue(), content_type='image/png')}, **auth)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertIn('/media/', response.json()['supplier']['image_url'])
            self.assertTrue(AuditEvent.objects.filter(entity_type='supplier', action='image_added', entity_id=str(self.supplier.pk)).exists())
            other = Business.objects.create(name='Different shop')
            BusinessMember.objects.create(user=self.owner, business=other, role='owner')
            self.assertEqual(self.client.delete(f'/api/v1/businesses/{other.pk}/suppliers/{self.supplier.pk}/image/', **auth).status_code, 404)
            self.assertEqual(self.client.delete(path, **auth).json()['supplier']['image_url'], None)

    def test_api_draft_completion_retry_and_supplier_search(self):
        login = self.client.post('/api/v1/auth/login/', data=json.dumps({'phone': self.owner.phone,
            'password': 'OwnerPass#83'}), content_type='application/json').json()
        auth = {'HTTP_AUTHORIZATION': f'Bearer {login["token"]}'}
        root = f'/api/v1/businesses/{self.business.pk}/'
        command_id = str(uuid.uuid4())
        payload = {'supplier_id': str(self.supplier.pk), 'location_id': self.location.pk,
            'lines': [{'product_id': str(self.product.pk), 'quantity': '2', 'unit_cost': '8.00'}]}
        response = self.client.post(root + 'purchases/', data=json.dumps(payload),
            content_type='application/json', HTTP_X_COMMAND_ID=command_id, **auth)
        self.assertEqual(response.status_code, 201, response.content)
        purchase_id = response.json()['purchase']['id']
        retry = self.client.post(root + 'purchases/', data=json.dumps(payload),
            content_type='application/json', HTTP_X_COMMAND_ID=command_id, **auth)
        self.assertEqual(retry.json()['purchase']['id'], purchase_id)
        self.assertEqual(Purchase.objects.count(), 1)
        self.assertEqual(self.client.get(root + 'suppliers/?search=Supplier', **auth).json()['suppliers'][0]['id'], str(self.supplier.pk))
        completion = str(uuid.uuid4())
        url = root + f'purchases/{purchase_id}/complete/'
        posted = self.client.post(url, data=json.dumps({'paid': '0'}), content_type='application/json',
            HTTP_X_COMMAND_ID=completion, **auth)
        self.assertEqual(posted.status_code, 200, posted.content)
        repeated = self.client.post(url, data=json.dumps({'paid': '0'}), content_type='application/json',
            HTTP_X_COMMAND_ID=completion, **auth)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(StockMovement.objects.filter(type='purchase').count(), 1)
