import json
import tempfile
from io import BytesIO

from django.test import TestCase, override_settings
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from .models import Business, BusinessMember, User, normalize_phone


class AccountApiTests(TestCase):
    def test_owner_can_upload_replace_and_remove_shop_logo(self):
        from .models import AuthSession

        token = self.register()
        business_id = self.create_business(token, 'Logo Shop')
        path = f'/api/v1/businesses/{business_id}/logo/'
        image = BytesIO()
        Image.new('RGB', (64, 32), '#126b5b').save(image, format='PNG')

        def upload(auth):
            return self.client.post(path, {'image': SimpleUploadedFile('logo.png', image.getvalue(), content_type='image/png')},
                                    HTTP_AUTHORIZATION=f'Bearer {auth}')

        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            first = upload(token)
            self.assertEqual(first.status_code, 200, first.content)
            self.assertIn('business_logos/', first.json()['logo_url'])
            self.assertEqual(upload(token).status_code, 200)
            self.assertTrue(Business.objects.get(pk=business_id).logo)
            invalid = self.client.post(path, {'image': SimpleUploadedFile('bad.png', b'not an image')},
                                       HTTP_AUTHORIZATION=f'Bearer {token}')
            self.assertEqual(invalid.status_code, 400)
            employee = User.objects.create_user('01812345678', password='EmployeePass#89')
            BusinessMember.objects.create(user=employee, business_id=business_id, role=BusinessMember.EMPLOYEE)
            employee_token = AuthSession.issue(employee)
            self.assertEqual(upload(employee_token).status_code, 403)
            self.assertEqual(self.client.delete(path, HTTP_AUTHORIZATION=f'Bearer {token}').status_code, 200)
            self.assertFalse(Business.objects.get(pk=business_id).logo)

    def test_phone_formats_normalize_to_one_bangladeshi_number(self):
        for value in ('01712345678', '+8801712345678', '8801712345678', '01712-345678', '+880 1712-345678', '(01712) 345678', '01712.345678'):
            with self.subTest(value=value):
                self.assertEqual(normalize_phone(value), '01712345678')
        for value in ('123', '+880181234567', '01712/345678'):
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    normalize_phone(value)

    def post_json(self, path, data, token=None):
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'} if token else {}
        return self.client.post(path, data=json.dumps(data), content_type='application/json', **headers)

    def register(self, phone='01712345678', username=None):
        data = {'phone': phone, 'password': 'StrongShopPass#83'}
        if username is not None:
            data['username'] = username
        response = self.post_json('/api/v1/auth/register/', data)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['token']

    def create_business(self, token, name):
        response = self.post_json('/api/v1/businesses/', {'name': name}, token)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['business']['id']

    def test_register_login_logout_without_business(self):
        token = self.register('+8801712345678')
        self.assertEqual(User.objects.get().phone, '01712345678')
        self.assertEqual(Business.objects.count(), 0)
        self.assertEqual(BusinessMember.objects.count(), 0)
        me = self.client.get('/api/v1/auth/me/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(me.json()['businesses'], [])
        self.assertEqual(me.json()['user']['name'], '')
        self.assertEqual(self.post_json('/api/v1/auth/login/', {'phone': '01712345678', 'password': 'wrong'}).status_code, 401)
        login = self.post_json('/api/v1/auth/login/', {'phone': '8801712345678', 'password': 'StrongShopPass#83'})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()['businesses'], [])
        second_token = login.json()['token']
        self.assertEqual(self.post_json('/api/v1/auth/logout/', {}, token).status_code, 200)
        self.assertEqual(self.client.get('/api/v1/auth/me/', HTTP_AUTHORIZATION=f'Bearer {token}').status_code, 401)
        self.assertEqual(self.client.get('/api/v1/auth/me/', HTTP_AUTHORIZATION=f'Bearer {second_token}').status_code, 200)

    def test_owner_creates_multiple_profiles(self):
        owner = self.register(username='Selim')
        retail = self.create_business(owner, 'Retail Shop')
        wholesale = self.create_business(owner, 'Wholesale Shop')
        self.assertNotEqual(retail, wholesale)
        profiles = self.client.get('/api/v1/businesses/', HTTP_AUTHORIZATION=f'Bearer {owner}').json()['businesses']
        self.assertEqual([(item['id'], item['role']) for item in profiles], [(retail, 'owner'), (wholesale, 'owner')])
        self.assertEqual(User.objects.get().first_name, 'Selim')

    def test_business_switcher_summary_uses_real_membership_scoped_counts(self):
        from .models import AuthSession
        from products.models import Product
        from stockkeeper.models import StockLocation

        owner_token = self.register()
        first = self.create_business(owner_token, 'First shop')
        second = self.create_business(owner_token, 'Second shop')
        Product.objects.create(business_id=first, name='Soap', sku='SOAP-1')
        Product.objects.create(business_id=first, name='Hidden', sku='HIDDEN-1', is_active=False)
        Product.objects.create(business_id=second, name='Rice', sku='RICE-2')
        StockLocation.objects.create(business_id=first, name='Warehouse', type=StockLocation.WAREHOUSE)
        outside = Business.objects.create(name='Outside shop')
        Product.objects.create(business=outside, name='Private', sku='PRIVATE-3')
        path = '/api/v1/businesses/switcher-summary/'
        self.assertEqual(self.client.get(path).status_code, 401)
        response = self.client.get(path, HTTP_AUTHORIZATION=f'Bearer {owner_token}')
        self.assertEqual(response.status_code, 200, response.content)
        stats = {item['business_id']: item for item in response.json()['businesses']}
        self.assertEqual(set(stats), {first, second})
        self.assertEqual(stats[first]['products'], 1)
        self.assertEqual(stats[first]['locations'], 2)
        self.assertEqual(stats[second]['products'], 1)
        employee = User.objects.create_user('01812345678', password='EmployeePass#89')
        BusinessMember.objects.create(user=employee, business_id=second, role=BusinessMember.EMPLOYEE)
        employee_stats = self.client.get(path, HTTP_AUTHORIZATION=f'Bearer {AuthSession.issue(employee)}')
        self.assertEqual([item['business_id'] for item in employee_stats.json()['businesses']], [second])

    def test_currency_symbol_setting_is_business_wide_and_owner_only(self):
        from .models import AuthSession

        owner_token = self.register()
        business_id = self.create_business(owner_token, 'Currency Shop')
        profile = self.client.get(f'/api/v1/businesses/{business_id}/profile/', HTTP_AUTHORIZATION=f'Bearer {owner_token}')
        self.assertTrue(profile.json()['business']['show_currency_symbol'])
        changed = self.client.patch(f'/api/v1/businesses/{business_id}/profile/',
                                    data=json.dumps({'show_currency_symbol': False}),
                                    content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {owner_token}')
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertFalse(changed.json()['business']['show_currency_symbol'])

        employee = User.objects.create_user('01812345678', password='EmployeePass#89')
        BusinessMember.objects.create(user=employee, business_id=business_id, role=BusinessMember.EMPLOYEE)
        employee_token = AuthSession.issue(employee)
        employee_profile = self.client.get(f'/api/v1/businesses/{business_id}/profile/', HTTP_AUTHORIZATION=f'Bearer {employee_token}')
        self.assertFalse(employee_profile.json()['business']['show_currency_symbol'])
        rejected = self.client.patch(f'/api/v1/businesses/{business_id}/profile/',
                                     data=json.dumps({'show_currency_symbol': True}),
                                     content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {employee_token}')
        self.assertEqual(rejected.status_code, 403)

    def test_invoice_footer_is_owner_editable_and_business_scoped(self):
        from .models import AuthSession

        owner = self.register()
        first = self.create_business(owner, 'First shop')
        second = self.create_business(owner, 'Second shop')
        path = f'/api/v1/businesses/{first}/profile/'
        saved = self.client.patch(path, data=json.dumps({'invoice_footer_text': 'ধন্যবাদ\nPlease keep this invoice.'}),
                                  content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {owner}')
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['business']['invoice_footer_text'], 'ধন্যবাদ\nPlease keep this invoice.')
        other = self.client.get(f'/api/v1/businesses/{second}/profile/', HTTP_AUTHORIZATION=f'Bearer {owner}')
        self.assertEqual(other.json()['business']['invoice_footer_text'], 'Thank you for your business.')
        invalid = self.client.patch(path, data=json.dumps({'invoice_footer_text': 'x' * 501}),
                                    content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {owner}')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(Business.objects.get(pk=first).invoice_footer_text, 'ধন্যবাদ\nPlease keep this invoice.')
        employee = User.objects.create_user('01812345678', password='EmployeePass#89')
        BusinessMember.objects.create(user=employee, business_id=first, role=BusinessMember.EMPLOYEE)
        employee_token = AuthSession.issue(employee)
        denied = self.client.patch(path, data=json.dumps({'invoice_footer_text': ''}),
                                   content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {employee_token}')
        self.assertEqual(denied.status_code, 403)

    def test_opening_cash_is_posted_only_during_business_creation(self):
        from decimal import Decimal
        from accounting.models import JournalEntry, MoneyAccount
        from accounting.services import balance

        token = self.register()
        created = self.post_json('/api/v1/businesses/', {'name': 'With cash', 'opening_cash': '1500.25'}, token)
        self.assertEqual(created.status_code, 201, created.content)
        business_id = created.json()['business']['id']
        cash = MoneyAccount.objects.get(business_id=business_id, is_default=True)
        self.assertEqual(balance(cash.ledger_account), Decimal('1500.25'))
        self.assertEqual(JournalEntry.objects.filter(business_id=business_id, source_type='money').count(), 1)

        invalid = self.post_json('/api/v1/businesses/', {'name': 'Invalid cash', 'opening_cash': '-2'}, token)
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(Business.objects.filter(name='Invalid cash').exists())

    def test_employees_are_scoped_to_business(self):
        owner = self.register()
        retail = self.create_business(owner, 'Retail Shop')
        wholesale = self.create_business(owner, 'Wholesale Shop')
        other_owner = self.register('01812345678')
        other_business = self.create_business(other_owner, 'Other Shop')
        create = self.post_json(f'/api/v1/businesses/{retail}/employees/', {
            'username': 'Nadia', 'phone': '01912345678', 'password': 'EmployeePass#89',
        }, owner)
        self.assertEqual(create.status_code, 201, create.content)
        retail_staff = self.client.get(f'/api/v1/businesses/{retail}/employees/', HTTP_AUTHORIZATION=f'Bearer {owner}')
        self.assertEqual(retail_staff.json()['employees'][0]['name'], 'Nadia')
        wholesale_staff = self.client.get(f'/api/v1/businesses/{wholesale}/employees/', HTTP_AUTHORIZATION=f'Bearer {owner}')
        self.assertEqual(wholesale_staff.json()['employees'], [])
        self.assertEqual(self.client.get(f'/api/v1/businesses/{retail}/employees/', HTTP_AUTHORIZATION=f'Bearer {other_owner}').status_code, 404)
        self.assertEqual(self.client.get(f'/api/v1/businesses/{other_business}/employees/', HTTP_AUTHORIZATION=f'Bearer {owner}').status_code, 404)
        employee_login = self.post_json('/api/v1/auth/login/', {'phone': '01912345678', 'password': 'EmployeePass#89'})
        employee_business = employee_login.json()['businesses'][0]
        self.assertEqual((employee_business['id'], employee_business['name'], employee_business['role']),
                         (retail, 'Retail Shop', 'employee'))
        self.assertTrue(employee_business['show_currency_symbol'])
        employee_token = employee_login.json()['token']
        self.assertEqual(self.client.get(f'/api/v1/businesses/{retail}/employees/', HTTP_AUTHORIZATION=f'Bearer {employee_token}').status_code, 403)
        self.assertEqual(self.post_json(f'/api/v1/businesses/{retail}/employees/', {
            'phone': '01612345678', 'password': 'EmployeePass#89',
        }, employee_token).status_code, 403)
        self.assertFalse(User.objects.filter(phone='01612345678').exists())

    def test_validation(self):
        owner = self.register()
        self.assertEqual(self.post_json('/api/v1/auth/register/', {
            'phone': '01712345678', 'password': 'StrongShopPass#83',
        }).status_code, 409)
        self.assertEqual(self.post_json('/api/v1/auth/register/', {'phone': '123', 'password': 'weak'}).status_code, 400)
        self.assertEqual(self.post_json('/api/v1/auth/register/', {
            'phone': '01812345678', 'password': 'StrongShopPass#83', 'username': 42,
        }).status_code, 400)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(Business.objects.count(), 0)
        self.assertEqual(self.post_json('/api/v1/businesses/', {'name': 'Unauthorized'}).status_code, 401)
        self.assertEqual(self.post_json('/api/v1/businesses/', {'name': ''}, owner).status_code, 400)
        self.assertEqual(Business.objects.count(), 0)

    def test_cors_allows_only_configured_web_preview(self):
        allowed = self.client.options('/api/v1/auth/login/', HTTP_ORIGIN='http://localhost:8081')
        self.assertEqual(allowed.status_code, 204)
        self.assertEqual(allowed['Access-Control-Allow-Origin'], 'http://localhost:8081')
        expo = self.client.options(
            '/api/v1/auth/register/',
            HTTP_ORIGIN='http://localhost:8082',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='content-type',
        )
        self.assertEqual(expo.status_code, 204)
        self.assertEqual(expo['Access-Control-Allow-Origin'], 'http://localhost:8082')
        self.assertIn('Content-Type', expo['Access-Control-Allow-Headers'])
        product_create = self.client.options(
            '/api/v1/businesses/1/products/',
            HTTP_ORIGIN='http://localhost:8081',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization,content-type,x-command-id',
        )
        self.assertEqual(product_create.status_code, 204)
        self.assertIn('POST', product_create['Access-Control-Allow-Methods'])
        self.assertIn('X-Command-ID', product_create['Access-Control-Allow-Headers'])
        product_image_remove = self.client.options(
            '/api/v1/businesses/1/products/00000000-0000-0000-0000-000000000000/image/',
            HTTP_ORIGIN='http://localhost:8081',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='DELETE',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization',
        )
        self.assertEqual(product_image_remove.status_code, 204)
        self.assertIn('DELETE', product_image_remove['Access-Control-Allow-Methods'])
        denied = self.client.options('/api/v1/auth/login/', HTTP_ORIGIN='https://unknown.example')
        self.assertNotIn('Access-Control-Allow-Origin', denied)
        with override_settings(DEBUG=False, API_ALLOWED_ORIGINS=set()):
            production = self.client.options('/api/v1/auth/register/', HTTP_ORIGIN='http://localhost:8082')
            self.assertEqual(production.status_code, 405)
            self.assertNotIn('Access-Control-Allow-Origin', production)

    def test_label_print_settings_are_owner_scoped_and_calibration_uses_saved_paper(self):
        from .label_settings import DEFAULT_LABEL_SETTINGS
        from .models import AuthSession
        import re

        owner = self.register()
        business_id = self.create_business(owner, 'Printer shop')
        other_id = self.create_business(owner, 'Other shop')
        settings = {**DEFAULT_LABEL_SETTINGS, 'paper': '2x4', 'width_mm': 50.8,
                    'height_mm': 101.6, 'horizontal_offset_mm': 2, 'rotation': 90}
        path = f'/api/v1/businesses/{business_id}/profile/'
        saved = self.client.patch(path, data=json.dumps({'label_print_settings': settings}),
                                  content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {owner}')
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['business']['label_print_settings'], settings)
        self.assertEqual(Business.objects.get(pk=other_id).label_print_settings, {})
        invalid = self.client.patch(path, data=json.dumps({'label_print_settings': {**settings, 'scale_percent': 0}}),
                                    content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {owner}')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(Business.objects.get(pk=business_id).label_print_settings, settings)

        employee = User.objects.create_user('01812345678', password='EmployeePass#89')
        BusinessMember.objects.create(user=employee, business_id=business_id, role=BusinessMember.EMPLOYEE)
        token = AuthSession.issue(employee)
        denied = self.client.patch(path, data=json.dumps({'label_print_settings': DEFAULT_LABEL_SETTINGS}),
                                   content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(denied.status_code, 403)
        calibration = f'/api/v1/businesses/{business_id}/label-calibration/'
        self.assertEqual(self.client.get(calibration).status_code, 404)
        response = self.client.get(calibration, HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200)
        box = re.search(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]', response.content)
        self.assertIsNotNone(box)
        self.assertAlmostEqual(float(box[1]), 50.8 * 72 / 25.4, delta=0.1)
        self.assertAlmostEqual(float(box[2]), 101.6 * 72 / 25.4, delta=0.1)
