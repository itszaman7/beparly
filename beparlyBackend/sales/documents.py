"""Sale invoices and receipts, laid out for A4 and 80 mm paper."""
from decimal import Decimal
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from .quotation_documents import _font


INK = colors.HexColor('#171717')
MUTED = colors.HexColor('#575757')
LINE = colors.HexColor('#C7C7C7')
PALE = colors.HexColor('#F2F2F2')


def _money(value, symbol=True):
    amount = f'{Decimal(value):,.2f}'
    return f'৳{amount}' if symbol else amount


def _wrap(value, font, size, width):
    lines = []
    for paragraph in str(value or '').splitlines() or ['']:
        current = ''
        for word in paragraph.split():
            if pdfmetrics.stringWidth(word, font, size) > width:
                if current:
                    lines.append(current)
                    current = ''
                fragment = ''
                for char in word:
                    if fragment and pdfmetrics.stringWidth(fragment + char, font, size) > width:
                        lines.append(fragment)
                        fragment = ''
                    fragment += char
                current = fragment
                continue
            candidate = f'{current} {word}'.strip()
            if current and pdfmetrics.stringWidth(candidate, font, size) > width:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current)
    return lines


def _address(value):
    return ', '.join(str(part) for part in value.values() if part) if isinstance(value, dict) else str(value or '')


def render_sale_document(sale, kind):
    if kind == 'label':
        from .thermal_label import render_thermal_label
        return render_thermal_label(sale)
    font = _font()
    receipt = kind == 'receipt'
    width, height = (80 * mm, 220 * mm) if receipt else A4
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(width, height), pageCompression=1)
    pdf.setTitle(f'{sale.invoice_number} - {"Receipt" if receipt else "Invoice"}')
    left, right = (7 * mm if receipt else 16 * mm), width - (7 * mm if receipt else 16 * mm)
    y = height - (9 * mm if receipt else 16 * mm)
    money = lambda value: _money(value, sale.business.show_currency_symbol)
    returned = sum((row.amount for row in sale.returns.all()), Decimal('0'))
    total, due = sale.total - returned, sale.total - returned - sale.paid

    def draw(value, x, baseline, size=9, color=INK, align='left'):
        pdf.setFillColor(color)
        pdf.setFont(font, size)
        {'left': pdf.drawString, 'right': pdf.drawRightString, 'center': pdf.drawCentredString}[align](
            x, baseline, str(value), shaping=True)

    def rule(at=None):
        pdf.setStrokeColor(LINE)
        pdf.setLineWidth(0.6)
        pdf.line(left, y if at is None else at, right, y if at is None else at)

    def heading():
        nonlocal y
        pdf.setFillColor(PALE)
        pdf.rect(left, y - 9 * mm, right - left, 9 * mm, fill=1, stroke=0)
        pdf.setStrokeColor(LINE)
        pdf.rect(left, y - 9 * mm, right - left, 9 * mm, fill=0, stroke=1)
        for edge in (left + 22 * mm, left + 113 * mm, left + 142 * mm):
            pdf.line(edge, y, edge, y - 9 * mm)
        draw('Quantity', left + 11 * mm, y - 5.5 * mm, 7.5, MUTED, 'center')
        draw('Description', left + 25 * mm, y - 5.5 * mm, 8, MUTED)
        draw('Unit price', left + 139 * mm, y - 5.5 * mm, 7.5, MUTED, 'right')
        draw('Line total', right - 3 * mm, y - 5.5 * mm, 7.5, MUTED, 'right')
        y -= 9 * mm

    def ensure(space, table=False):
        nonlocal y
        if y - space >= 22 * mm:
            return
        pdf.showPage()
        y = height - 16 * mm
        draw(f'{sale.business.name} / {sale.invoice_number} - continued', left, y, 9)
        y -= 10 * mm
        if table:
            heading()

    def block(value, x, available, size=8.5):
        nonlocal y
        lines = _wrap(value, font, size, available)
        ensure(len(lines) * 5 * mm)
        for part in lines:
            draw(part, x, y, size)
            y -= 5 * mm

    has_logo = False
    if sale.business.logo:
        try:
            sale.business.logo.open('rb')
            try:
                logo = ImageReader(BytesIO(sale.business.logo.read()))
            finally:
                sale.business.logo.close()
            box = (width / 2 - 12 * mm, y - 13 * mm, 24 * mm, 13 * mm) if receipt else (
                left, y - 34 * mm, 27 * mm, 20 * mm)
            pdf.drawImage(logo, *box, preserveAspectRatio=True,
                          anchor='c', mask='auto')
            has_logo = True
        except (OSError, ValueError, NotImplementedError):
            pass
    if receipt:
        y -= 17 * mm if has_logo else 0
        draw(sale.business.name, width / 2, y, 12, INK, 'center')
        y -= 6 * mm
        for detail in (sale.business.phone, sale.business.address):
            if detail:
                for part in _wrap(detail, font, 8, right - left):
                    draw(part, width / 2, y, 8, MUTED, 'center')
                    y -= 4 * mm
        y -= 2 * mm
        rule()
        y -= 6 * mm
        block(f'RECEIPT {sale.invoice_number}', left, right - left, 9)
        block(f'Date: {sale.invoice_date:%d %b %Y}', left, right - left, 8)
        block(f'Customer: {sale.customer_name_snapshot or "Walk-in Customer"}', left, right - left, 8)
    else:
        draw('SALES INVOICE', width / 2, y, 17, INK, 'center')
        y -= 13 * mm
        name_x = left + (32 * mm if has_logo else 0)
        name_y = y - 4 * mm
        for part in _wrap(sale.business.name, font, 12, 85 * mm - (name_x - left)):
            draw(part, name_x, name_y, 12)
            name_y -= 5 * mm
        for detail in (sale.business.phone, sale.business.address):
            if detail:
                for part in _wrap(detail, font, 8, 85 * mm - (name_x - left)):
                    draw(part, name_x, name_y, 8, MUTED)
                    name_y -= 4 * mm
        meta_y = y - 4 * mm
        for label, value in (('Date', f'{sale.invoice_date:%d %b %Y}'), ('Invoice no', sale.invoice_number),
                             ('Generated by', 'Admin')):
            draw(label, right - 69 * mm, meta_y, 8, MUTED)
            draw(value, right, meta_y, 8.5, INK, 'right')
            meta_y -= 6 * mm
        y = min(y - 27 * mm, name_y - 5 * mm, meta_y - 3 * mm)
        rule()
        y -= 7 * mm
        draw('SOLD TO', left, y, 8, INK)
        y -= 6 * mm
        for detail in (sale.customer_name_snapshot or 'Walk-in Customer', _address(sale.customer_address_snapshot),
                       sale.customer_phone_snapshot):
            if detail:
                for part in _wrap(detail, font, 8.5, right - left):
                    draw(part, left, y, 8.5, INK if detail == (sale.customer_name_snapshot or 'Walk-in Customer') else MUTED)
                    y -= 5 * mm
        y -= 3 * mm
        shipping = _address(sale.delivery_address)
        if shipping:
            draw('DELIVER TO', left, y, 8, MUTED)
            y -= 5 * mm
            block(shipping, left, right - left)
            y -= 3 * mm
        heading()

    items = list(sale.lines.all())
    for index, item in enumerate(items, 1):
        name = item.product_name + (f' / {item.variant_name}' if item.variant_name else '')
        quantity = f'{item.quantity:g} {item.unit_name}'
        if receipt:
            lines = _wrap(name, font, 8.5, right - left)
            ensure((len(lines) + 2) * 5 * mm + (55 * mm if index == len(items) else 0))
            for part in lines:
                draw(part, left, y, 8.5)
                y -= 4.5 * mm
            draw(f'{quantity} x {money(item.unit_price)}', left, y, 8, MUTED)
            draw(money(item.line_total), right, y, 8.5, INK, 'right')
            y -= 7 * mm
        else:
            lines = _wrap(name, font, 8.5, 84 * mm)
            sku_lines = _wrap(f'SKU: {item.sku}', font, 7.5, 84 * mm) if item.sku else []
            row_height = max(11 * mm, (len(lines) + len(sku_lines)) * 4.5 * mm + 3 * mm)
            ensure(row_height + (75 * mm if index == len(items) else 2 * mm), table=True)
            top = y
            draw(quantity, left + 11 * mm, top - 5 * mm, 7.5, INK, 'center')
            for part in lines:
                draw(part, left + 25 * mm, y - 4 * mm, 8.5)
                y -= 4.5 * mm
            for part in sku_lines:
                draw(part, left + 25 * mm, y - 2 * mm, 7.5, MUTED)
                y -= 4.5 * mm
            draw(money(item.unit_price), left + 139 * mm, top - 5 * mm, 8, INK, 'right')
            draw(money(item.line_total), right - 3 * mm, top - 5 * mm, 8, INK, 'right')
            y = top - row_height
            pdf.setStrokeColor(LINE)
            pdf.line(left, y, right, y)
            for edge in (left, left + 22 * mm, left + 113 * mm, left + 142 * mm, right):
                pdf.line(edge, top, edge, y)

    if not receipt:
        for _ in range(max(0, 7 - len(items))):
            ensure(10 * mm + 75 * mm, table=True)
            top = y
            y -= 10 * mm
            pdf.setStrokeColor(LINE)
            pdf.line(left, y, right, y)
            for edge in (left, left + 22 * mm, left + 113 * mm, left + 142 * mm, right):
                pdf.line(edge, top, edge, y)

    ensure(75 * mm if not receipt else 55 * mm)
    if receipt:
        rule()
        y -= 6 * mm
        label_x, amount_x = left, right
    else:
        y -= 5 * mm
        label_x, amount_x = right - 70 * mm, right - 3 * mm

    def total_row(label, value, strong=False):
        nonlocal y
        if not receipt:
            pdf.setFillColor(PALE if strong else colors.white)
            pdf.setStrokeColor(LINE)
            pdf.rect(label_x, y - 2 * mm, right - label_x, 7 * mm, fill=1, stroke=1)
            pdf.line(right - 34 * mm, y - 2 * mm, right - 34 * mm, y + 5 * mm)
        draw(label, label_x + (3 * mm if not receipt else 0), y, 8.5)
        draw(value, amount_x, y, 9 if strong else 8.5, INK, 'right')
        y -= 7 * mm if not receipt else 6 * mm

    total_row('Subtotal', money(sale.subtotal))
    if not receipt or sale.discount:
        total_row('Discount', f'-{money(sale.discount)}')
    if sale.delivery_fee:
        total_row('Delivery', money(sale.delivery_fee))
    if returned:
        total_row('Returned items', f'-{money(returned)}')
    total_row('Grand total', money(total), True)
    total_row('Paid amount', money(sale.paid))
    total_row('Due amount', money(due), due > 0)
    footer = sale.business.invoice_footer_text.strip()
    if footer:
        lines = _wrap(footer, font, 8, right - left)
        ensure(len(lines) * 4.5 * mm + 13 * mm)
        y -= 4 * mm
        rule()
        y -= 8 * mm
        for part in lines:
            draw(part, left if receipt else width / 2, y, 8, MUTED, 'left' if receipt else 'center')
            y -= 4.5 * mm
    pdf.save()
    return stream.getvalue()
