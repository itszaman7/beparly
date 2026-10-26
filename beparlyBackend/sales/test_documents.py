from datetime import date
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from reportlab.pdfgen import canvas
from PIL import Image

from .documents import _money, render_sale_document


class Rows(list):
    def all(self):
        return self


class SaleDocumentTests(TestCase):
    def sale(self, count=2):
        business = SimpleNamespace(name='Stay Fresh', phone='01345678901', address='Dhaka, Bangladesh',
                                   logo=None, show_currency_symbol=True,
                                   invoice_footer_text='ধন্যবাদ\nPlease keep this invoice.')
        lines = Rows(SimpleNamespace(product_name=f'Example product {index}', variant_name='', sku=f'SKU-{index}',
                                     unit_name='piece', quantity=Decimal('2'), unit_price=Decimal('1000'),
                                     line_total=Decimal('2000')) for index in range(count))
        return SimpleNamespace(business=business, invoice_number='INV-2026-0123', invoice_date=date(2026, 10, 25),
                               customer_name_snapshot='Example Customer', customer_phone_snapshot='01711000000',
                               customer_address_snapshot={'city': 'Dhaka'}, billing_address={}, delivery_address={},
                               subtotal=Decimal(2000 * count), discount=Decimal('100'), delivery_fee=Decimal('80'),
                               total=Decimal(2000 * count - 20), paid=Decimal('500'), returns=Rows(), lines=lines)

    def test_bdt_and_symbol_setting(self):
        self.assertEqual(_money(Decimal('2480.00')), '৳2,480.00')
        self.assertEqual(_money(Decimal('2480.00'), False), '2,480.00')

    def test_invoice_and_receipt_render_with_bengali_footer(self):
        sale = self.sale()
        for kind in ('invoice', 'receipt'):
            with self.subTest(kind=kind):
                pdf = render_sale_document(sale, kind)
                self.assertTrue(pdf.startswith(b'%PDF-'))
                self.assertGreater(len(pdf), 1000)

    def test_paper_variants_have_expected_geometry(self):
        import re
        sale = self.sale()
        for kind, paper, expected in (('invoice', 'A4', (595.28, 841.89)),
                                      ('invoice', 'A5', (419.53, 595.28)),
                                      ('receipt', '58mm', (58 * 72 / 25.4, None)),
                                      ('receipt', '80mm', (80 * 72 / 25.4, None))):
            with self.subTest(kind=kind, paper=paper):
                pdf = render_sale_document(sale, kind, paper)
                box = re.search(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]', pdf)
                self.assertIsNotNone(box)
                self.assertAlmostEqual(float(box[1]), expected[0], delta=0.2)
                if expected[1]:
                    self.assertAlmostEqual(float(box[2]), expected[1], delta=0.2)
        with self.assertRaises(ValueError):
            render_sale_document(sale, 'receipt', 'A4')

    def test_invoice_and_receipt_embed_logo_without_local_path(self):
        image = BytesIO()
        Image.new('RGB', (120, 60), '#256b5d').save(image, format='PNG')

        class StoredLogo:
            def __bool__(self):
                return True

            def open(self, mode):
                self.stream = BytesIO(image.getvalue())

            def read(self):
                return self.stream.read()

            def close(self):
                self.stream.close()

            @property
            def path(self):
                raise AssertionError('PDF rendering must not require a local path')

        sale = self.sale()
        sale.business.logo = StoredLogo()
        original = canvas.Canvas.drawImage
        drawn = []

        def capture(pdf, *args, **kwargs):
            drawn.append(args[0])
            return original(pdf, *args, **kwargs)

        with patch.object(canvas.Canvas, 'drawImage', capture):
            for kind in ('invoice', 'receipt'):
                with self.subTest(kind=kind):
                    self.assertTrue(render_sale_document(sale, kind).startswith(b'%PDF-'))
        self.assertEqual(len(drawn), 2)

    def test_long_invoice_paginates(self):
        pdf = render_sale_document(self.sale(count=65), 'invoice')
        self.assertGreater(pdf.count(b'/Type /Page\n'), 1)

    def test_sales_label_uses_sale_snapshots_without_delivery_details(self):
        sale = self.sale()
        sale.customer_address_snapshot = {'address': 'Customer lane'}
        sale.billing_address = {'text': 'Shop only address'}
        sale.delivery_address = {'text': 'Courier delivery address'}
        original = canvas.Canvas.drawString
        drawn = []

        def record(pdf, x, y, value, **kwargs):
            drawn.append(str(value))
            return original(pdf, x, y, value, **kwargs)

        with patch.object(canvas.Canvas, 'drawString', record):
            label = render_sale_document(sale, 'label')
        self.assertTrue(label.startswith(b'%PDF-'))
        self.assertIn('Customer lane', drawn)
        self.assertNotIn('Shop only address', drawn)
        self.assertNotIn('Courier delivery address', drawn)
        self.assertNotIn('Delivery fee', drawn)

        sale.customer_address_snapshot = {}
        drawn.clear()
        with patch.object(canvas.Canvas, 'drawString', record):
            render_sale_document(sale, 'label')
        self.assertNotIn('Shop only address', drawn)
        self.assertNotIn('Courier delivery address', drawn)
        self.assertGreater(render_sale_document(self.sale(count=20), 'label').count(b'/Type /Page\n'), 1)

    def test_label_paper_and_calibration_change_pdf_geometry(self):
        import re
        from accounts.label_settings import DEFAULT_LABEL_SETTINGS
        from .thermal_label import render_label_calibration

        sale = self.sale()
        settings = {**DEFAULT_LABEL_SETTINGS, 'paper': '2x4', 'width_mm': 50.8, 'height_mm': 101.6,
                    'horizontal_offset_mm': 2, 'vertical_offset_mm': -3, 'rotation': 90}
        sale.business.label_print_settings = settings
        rotations = []
        original = canvas.Canvas.rotate

        def record(pdf, angle):
            rotations.append(angle)
            return original(pdf, angle)

        with patch.object(canvas.Canvas, 'rotate', record):
            label = render_sale_document(sale, 'label')
        box = re.search(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]', label)
        self.assertIsNotNone(box)
        self.assertAlmostEqual(float(box[1]), 50.8 * 72 / 25.4, delta=0.1)
        self.assertAlmostEqual(float(box[2]), 101.6 * 72 / 25.4, delta=0.1)
        self.assertIn(90, rotations)
        self.assertTrue(render_label_calibration(sale.business).startswith(b'%PDF-'))

    def test_invoice_and_label_show_sale_discount_amount(self):
        originals = {name: getattr(canvas.Canvas, name) for name in ('drawString', 'drawRightString')}
        drawn = []

        def record(name):
            def call(pdf, x, y, value, **kwargs):
                drawn.append(str(value))
                return originals[name](pdf, x, y, value, **kwargs)
            return call

        sale = self.sale()
        for amount in (Decimal('100'), Decimal('0')):
            sale.discount = amount
            sale.total = sale.subtotal - amount + sale.delivery_fee
            for kind in ('invoice', 'label'):
                with self.subTest(kind=kind, discount=amount), \
                     patch.object(canvas.Canvas, 'drawString', record('drawString')), \
                     patch.object(canvas.Canvas, 'drawRightString', record('drawRightString')):
                    render_sale_document(sale, kind)
                self.assertTrue(any('Discount' in value for value in drawn))
                self.assertTrue(any(f'-৳{amount:,.2f}' in value for value in drawn))
                drawn.clear()

    def test_invoice_uses_customer_address_and_identifies_generator(self):
        original_left = canvas.Canvas.drawString
        original_right = canvas.Canvas.drawRightString
        drawn = []

        def record_left(pdf, x, y, value, **kwargs):
            drawn.append(str(value))
            return original_left(pdf, x, y, value, **kwargs)

        def record_right(pdf, x, y, value, **kwargs):
            drawn.append(str(value))
            return original_right(pdf, x, y, value, **kwargs)

        sale = self.sale()
        sale.billing_address = {'text': 'Shop only address'}
        sale.customer_address_snapshot = {}
        with patch.object(canvas.Canvas, 'drawString', record_left), patch.object(canvas.Canvas, 'drawRightString', record_right):
            render_sale_document(sale, 'invoice')
        self.assertNotIn('Shop only address', drawn)
        self.assertIn('Generated by', drawn)
        self.assertIn('Admin', drawn)

        drawn.clear()
        sale.customer_address_snapshot = {'address': 'Customer lane'}
        with patch.object(canvas.Canvas, 'drawString', record_left), patch.object(canvas.Canvas, 'drawRightString', record_right):
            render_sale_document(sale, 'invoice')
        self.assertIn('Customer lane', drawn)
        self.assertNotIn('Shop only address', drawn)
