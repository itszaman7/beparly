"""A4 and A5 price offers rendered from issued quotation snapshots."""
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, A5
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


FONT = 'NotoSansBengaliQuotation'
INK = colors.HexColor('#202923')
MUTED = colors.HexColor('#59665F')
LINE = colors.HexColor('#D9E1DC')
PALE = colors.HexColor('#F2F5F3')


def _font():
    try:
        import uharfbuzz  # noqa: F401 - ReportLab uses this for Bengali glyph shaping.
    except ImportError as exc:
        raise ImportError('Install backend requirements to enable Bengali quotation PDFs (uharfbuzz).') from exc
    if FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(FONT, str(Path(__file__).with_name('NotoSansBengali.ttf'))))
    if not pdfmetrics.getFont(FONT).shapable:
        raise ImportError('Bengali PDF shaping requires uharfbuzz.')
    return FONT


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


def render_quotation(quote, size='a4'):
    font = _font()
    width, height = A4 if size == 'a4' else A5
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(width, height), pageCompression=1)
    pdf.setTitle(f'{quote.number} - Quotation')
    left, right = 16 * mm, width - 16 * mm
    y = height - 16 * mm
    meta_x = left + (100 * mm if size == 'a4' else 65 * mm)
    qty_x, unit_x, total_x = right - 55 * mm, right - 26 * mm, right - 2 * mm
    description_width = qty_x - left - 16 * mm
    money = lambda value: f'৳{Decimal(value):,.2f}' if quote.business.show_currency_symbol else f'{Decimal(value):,.2f}'

    def draw(value, x, baseline, size=9, color=INK, align='left'):
        pdf.setFillColor(color)
        pdf.setFont(font, size)
        {'left': pdf.drawString, 'right': pdf.drawRightString, 'center': pdf.drawCentredString}[
            align](x, baseline, str(value), shaping=True)

    def rule(at=None):
        pdf.setStrokeColor(LINE)
        pdf.setLineWidth(0.6)
        pdf.line(left, y if at is None else at, right, y if at is None else at)

    def heading():
        nonlocal y
        pdf.setFillColor(PALE)
        pdf.rect(left, y - 7 * mm, right - left, 9 * mm, fill=1, stroke=0)
        for label, x, align in (('#', left + 2 * mm, 'left'), ('Description', left + 12 * mm, 'left'),
                                ('Qty', qty_x, 'right'), ('Unit price', unit_x, 'right'),
                                ('Total', total_x, 'right')):
            draw(label, x, y - 3 * mm, 7.5, MUTED, align)
        y -= 10 * mm

    def ensure(space, table=False):
        nonlocal y
        if y - space >= 23 * mm:
            return
        pdf.showPage()
        y = height - 16 * mm
        draw(f'{quote.business.name} / {quote.number} - continued', left, y, 8.5)
        y -= 10 * mm
        if table:
            heading()

    def block(value, x, available, size=8.5, color=INK, centered=False):
        nonlocal y
        for part in _wrap(value, font, size, available):
            ensure(5 * mm)
            draw(part, width / 2 if centered else x, y, size, color, 'center' if centered else 'left')
            y -= 5 * mm

    logo = getattr(quote.business, 'logo', None)
    if logo:
        try:
            pdf.drawImage(ImageReader(logo.path), left, y - 17 * mm, 32 * mm, 17 * mm,
                          preserveAspectRatio=True, anchor='c', mask='auto')
        except (OSError, ValueError):
            pass
    name_x = left + (37 * mm if logo else 0)
    for part in _wrap(quote.business.name, font, 15 if size == 'a4' else 13, right - name_x):
        draw(part, name_x, y - 3 * mm, 15 if size == 'a4' else 13)
        y -= 6 * mm
    detail_y = y - 3 * mm
    for detail in (quote.business.phone, quote.business.address):
        if detail:
            for part in _wrap(detail, font, 8, right - name_x):
                draw(part, name_x, detail_y, 8, MUTED)
                detail_y -= 4 * mm
    y = min(y - (16 * mm if logo else 10 * mm), detail_y - 5 * mm)
    rule()
    y -= 9 * mm
    draw('BILL TO', left, y, 8, MUTED)
    draw('QUOTATION', meta_x, y + 1 * mm, 17 if size == 'a4' else 14)
    y -= 6 * mm
    customer_top = y
    customer_width = meta_x - left - 5 * mm
    for detail in (quote.customer_name or 'Walk-in Customer', quote.customer_phone, quote.customer_address):
        if detail:
            for part in _wrap(detail, font, 8.5, customer_width):
                draw(part, left, y, 8.5)
                y -= 5 * mm
    meta_y = customer_top
    for label, value in (('Quotation no', quote.number), ('Issued', f'{quote.issued_at:%d %b %Y}'),
                         ('Valid until', f'{quote.valid_until:%d %b %Y}')):
        draw(label, meta_x, meta_y, 7.5, MUTED)
        draw(value, right, meta_y, 8, INK, 'right')
        meta_y -= 6 * mm
    y = min(y, meta_y) - 7 * mm
    if quote.delivery_address:
        draw('DELIVER TO', left, y, 8, MUTED)
        y -= 5 * mm
        block(quote.delivery_address, left, right - left, 8.5)
        y -= 3 * mm
    heading()

    lines = list(quote.lines.order_by('pk'))
    for index, row in enumerate(lines, 1):
        name = row.product_name + (f' / {row.variant_name}' if row.variant_name else '')
        name_lines = _wrap(name, font, 8.5, description_width)
        sku_lines = _wrap(f'SKU: {row.sku}', font, 7.5, description_width) if row.sku else []
        row_height = max(11 * mm, (len(name_lines) + len(sku_lines)) * 5 * mm + 3 * mm)
        ensure(row_height + 2 * mm, table=True)
        top = y
        draw(str(index), left + 2 * mm, top - 3 * mm, 8, MUTED)
        for part in name_lines:
            draw(part, left + 12 * mm, y - 3 * mm, 8.5)
            y -= 5 * mm
        for part in sku_lines:
            draw(part, left + 12 * mm, y - 2 * mm, 7.5, MUTED)
            y -= 5 * mm
        draw(f'{row.quantity:g} {row.unit_name}', qty_x, top - 3 * mm, 7.5, INK, 'right')
        draw(money(row.unit_price), unit_x, top - 3 * mm, 7.5, INK, 'right')
        draw(money(row.line_total), total_x, top - 3 * mm, 8, INK, 'right')
        y = top - row_height
        rule(y + 1 * mm)
        y -= 3 * mm

    ensure(42 * mm)
    y -= 5 * mm
    label_x = right - (67 * mm if size == 'a4' else 64 * mm)

    def total_row(label, value, strong=False):
        nonlocal y
        if strong:
            pdf.setFillColor(PALE)
            pdf.rect(label_x - 3 * mm, y - 2.5 * mm, right - label_x + 3 * mm, 7 * mm, fill=1, stroke=0)
        draw(label, label_x, y, 9 if strong else 8)
        draw(value, total_x, y, 9 if strong else 8, INK, 'right')
        y -= 6 * mm

    total_row('Subtotal', money(quote.subtotal))
    if quote.discount:
        total_row('Discount', f'-{money(quote.discount)}')
    if quote.delivery_fee:
        total_row('Delivery', money(quote.delivery_fee))
    total_row('Total', money(quote.total), True)
    ensure(12 * mm)
    y -= 3 * mm
    draw('Generated by: Admin', right, y, 8, MUTED, 'right')
    y -= 7 * mm
    if quote.notes:
        ensure(13 * mm)
        draw('NOTES', left, y, 8, MUTED)
        y -= 6 * mm
        block(quote.notes, left, right - left, 8.5)
        y -= 3 * mm
    footer = getattr(quote.business, 'invoice_footer_text', '').strip()
    if footer:
        ensure(15 * mm)
        rule()
        y -= 8 * mm
        block(footer, left, right - left, 8, MUTED, centered=True)
    pdf.save()
    return stream.getvalue()
