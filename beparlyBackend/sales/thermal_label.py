"""Narrow roll-paper sales label with receipt-style typography."""
from decimal import Decimal
from io import BytesIO

from reportlab.graphics.barcode import code128
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from .quotation_documents import _font
from .documents import _address, _money, _wrap
from accounts.label_settings import label_settings


BLACK = colors.HexColor('#171717')
GRAY = colors.HexColor('#555555')


def render_thermal_label(sale):
    font = _font()
    settings = label_settings(sale.business)
    paper_width, paper_height = settings['width_mm'] * mm, settings['height_mm'] * mm
    width = 80 * mm
    left, right = 7 * mm, 73 * mm
    money = lambda value: _money(value, sale.business.show_currency_symbol)
    returned = sum((row.amount for row in sale.returns.all()), Decimal('0'))
    total = sale.total - returned
    due = total - sale.paid

    business_address = _wrap(sale.business.address, font, 7.5, right - left) if sale.business.address else []
    customer_address = _address(sale.customer_address_snapshot)
    address_lines = _wrap(customer_address, font, 7.5, right - left) if customer_address else []
    footer = sale.business.invoice_footer_text.strip() or 'THANK YOU!'
    footer_lines = _wrap(footer, font, 8, right - left)

    rows = []
    for item in sale.lines.all():
        name = item.product_name + (f' / {item.variant_name}' if item.variant_name else '')
        name_lines = _wrap(name, font, 8, 29 * mm)
        row_height = max(6 * mm, len(name_lines) * 4.2 * mm + 2 * mm)
        rows.append((item, name_lines, row_height))
    pages, current, used = [], [], 0
    for row in rows:
        if current and used + row[2] > 88 * mm:
            pages.append(current)
            current, used = [], 0
        current.append(row)
        used += row[2]
    if current or not pages:
        pages.append(current)

    total_rows = 4
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(paper_width, paper_height), pageCompression=1)
    pdf.setTitle(f'{sale.invoice_number} - Sales label')

    def draw(value, x, y, size=8, color=BLACK, align='left'):
        pdf.setFillColor(color)
        pdf.setFont(font, size)
        {'left': pdf.drawString, 'right': pdf.drawRightString, 'center': pdf.drawCentredString}[
            align](x, y, str(value), shaping=True)

    def dashed(y):
        pdf.setStrokeColor(GRAY)
        pdf.setLineWidth(0.45)
        pdf.setDash(2 * mm, 1.4 * mm)
        pdf.line(left, y, right, y)
        pdf.setDash()

    def amounts(label, value, y, strong=False):
        draw(label, left + 2 * mm, y, 10 if strong else 8.5)
        draw(value, right - 2 * mm, y, 10 if strong else 8.5, BLACK, 'right')

    def item_amount_size(value):
        size = 8
        while size > 6 and pdfmetrics.stringWidth(value, font, size) > 20 * mm:
            size -= 0.5
        return size

    for page_number, page_rows in enumerate(pages, 1):
        item_height = sum(row[2] for row in page_rows)
        content_height = (115 + len(business_address) * 4 + len(address_lines) * 4 +
                          len(footer_lines) * 4 + total_rows * 5 + item_height / mm) * mm
        height = max(125 * mm, content_height)
        rotated = settings['rotation'] in (90, 270)
        projected_width, projected_height = (height, width) if rotated else (width, height)
        inset = (settings['inner_padding_mm'] + settings['safe_margin_mm']) * mm
        fit = min((paper_width - 2 * inset) / projected_width,
                  (paper_height - 2 * inset) / projected_height)
        fit *= settings['scale_percent'] / 100
        origin_x = (paper_width - projected_width * fit) / 2 + settings['horizontal_offset_mm'] * mm
        origin_y = (paper_height - projected_height * fit) / 2 - settings['vertical_offset_mm'] * mm
        pdf.saveState()
        rotation = settings['rotation']
        if rotation == 90:
            pdf.translate(origin_x + height * fit, origin_y)
        elif rotation == 180:
            pdf.translate(origin_x + width * fit, origin_y + height * fit)
        elif rotation == 270:
            pdf.translate(origin_x, origin_y + width * fit)
        else:
            pdf.translate(origin_x, origin_y)
        pdf.rotate(rotation)
        pdf.scale(fit, fit)
        y = height - 8 * mm

        draw('SALE LABEL', width / 2, y, 9, BLACK, 'center')
        y -= 6 * mm
        for part in _wrap(sale.business.name, font, 11, right - left):
            draw(part, width / 2, y, 11, BLACK, 'center')
            y -= 5 * mm
        for part in business_address:
            draw(part, width / 2, y, 7.5, GRAY, 'center')
            y -= 4 * mm
        if sale.business.phone:
            draw(f'Tel: {sale.business.phone}', width / 2, y, 7.5, GRAY, 'center')
            y -= 5 * mm
        y -= 2 * mm
        dashed(y)
        y -= 6 * mm

        draw(f'{sale.invoice_date:%d %b %Y}', left + 2 * mm, y, 8)
        if len(pages) > 1:
            draw(f'{page_number} / {len(pages)}', right - 2 * mm, y, 7.5, GRAY, 'right')
        y -= 5 * mm
        draw(f'Order: {sale.invoice_number}', left + 2 * mm, y, 8)
        y -= 5 * mm
        for part in _wrap(f'To: {sale.customer_name_snapshot or "Walk-in Customer"}', font, 8, right - left - 4 * mm):
            draw(part, left + 2 * mm, y, 8)
            y -= 4 * mm
        for part in address_lines:
            draw(part, left + 2 * mm, y, 7.5, GRAY)
            y -= 4 * mm
        if sale.customer_phone_snapshot:
            draw(sale.customer_phone_snapshot, left + 2 * mm, y, 8)
            y -= 5 * mm
        y -= 2 * mm
        dashed(y)
        y -= 6 * mm

        draw('QTY', left + 2 * mm, y, 8)
        draw('ITEM', left + 15 * mm, y, 8)
        draw('AMT', right - 2 * mm, y, 8, BLACK, 'right')
        y -= 4 * mm
        dashed(y)
        y -= 5 * mm
        for item, name_lines, row_height in page_rows:
            top = y
            draw(f'{item.quantity:g}', left + 2 * mm, y, 8)
            amount_text = money(item.line_total)
            draw(amount_text, right - 2 * mm, y, item_amount_size(amount_text), BLACK, 'right')
            for part in name_lines:
                draw(part, left + 15 * mm, y, 8)
                y -= 4.2 * mm
            y = top - row_height
        y -= 2 * mm
        dashed(y)
        y -= 6 * mm

        amounts('Discount', f'-{money(sale.discount)}', y)
        y -= 5 * mm
        amounts('Total', money(total), y, True)
        y -= 6 * mm
        amounts('Paid', money(sale.paid), y)
        y -= 5 * mm
        amounts('Due', money(due), y, True)
        y -= 5 * mm
        dashed(y)
        y -= 6 * mm
        for part in footer_lines:
            draw(part, width / 2, y, 8, BLACK, 'center')
            y -= 4 * mm
        y -= 3 * mm
        dashed(y)

        barcode = code128.Code128(sale.invoice_number, barWidth=0.38 * mm, barHeight=15 * mm,
                                  humanReadable=False)
        scale = min(1, (right - left - 6 * mm) / barcode.width)
        y -= 19 * mm
        pdf.saveState()
        pdf.translate((width - barcode.width * scale) / 2, y)
        pdf.scale(scale, 1)
        barcode.drawOn(pdf, 0, 0)
        pdf.restoreState()
        draw(sale.invoice_number, width / 2, y - 4 * mm, 7.5, BLACK, 'center')
        if y - 4 * mm < 5 * mm:
            raise ValueError(f'Sales label content exceeded the page: {y / mm:.1f} mm remaining.')
        pdf.restoreState()
        pdf.showPage()

    pdf.save()
    return stream.getvalue()


def render_label_calibration(business):
    settings = label_settings(business)
    width, height = settings['width_mm'] * mm, settings['height_mm'] * mm
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(width, height), pageCompression=1)
    inset = settings['safe_margin_mm'] * mm
    pdf.setLineWidth(0.35)
    pdf.rect(inset, inset, width - 2 * inset, height - 2 * inset)
    pdf.setFont('Helvetica', 8)
    pdf.drawCentredString(width / 2, height - inset - 9 * mm, 'LABEL CALIBRATION TEST')
    pdf.drawCentredString(width / 2, height - inset - 14 * mm,
                          f"Expected paper: {settings['width_mm']:g} x {settings['height_mm']:g} mm")
    # A 50 mm ruler makes printer scaling measurable independently of the page edge.
    ruler_y = height / 2
    ruler_x = (width - 50 * mm) / 2
    ruler_length = 50 * mm * settings['scale_percent'] / 100
    pdf.saveState()
    pdf.translate(width / 2 + settings['horizontal_offset_mm'] * mm,
                  height / 2 - settings['vertical_offset_mm'] * mm)
    pdf.rotate(settings['rotation'])
    pdf.translate(-width / 2, -height / 2)
    pdf.line(ruler_x, ruler_y, ruler_x + ruler_length, ruler_y)
    for x in (ruler_x, ruler_x + ruler_length):
        pdf.line(x, ruler_y - 3 * mm, x, ruler_y + 3 * mm)
    pdf.drawCentredString(width / 2, ruler_y + 5 * mm, '50 mm reference')
    pdf.restoreState()
    for x in (inset, width - inset):
        for y in (inset, height - inset):
            pdf.line(x - 2 * mm, y, x + 2 * mm, y)
            pdf.line(x, y - 2 * mm, x, y + 2 * mm)
    pdf.showPage()
    pdf.save()
    return stream.getvalue()
