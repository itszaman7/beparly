"""A4/A5 price offers. Values come from the issued quotation and its line snapshots."""
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, A5
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


FONT = 'NotoSansBengaliQuotation'


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


def render_quotation(quote, size='a4'):
    font = _font()
    width, height = A4 if size == 'a4' else A5
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(width, height), pageCompression=1)
    left, right = 16 * mm, width - 16 * mm
    y = height - 18 * mm

    def text(value, size=9, gap=5, align='left'):
        nonlocal y
        pdf.setFont(font, size)
        value = str(value)
        limit = (right - left) if align == 'left' else (right - left)
        words = value.split(' ')
        parts, current = [], ''
        for word in words:
            candidate = f'{current} {word}'.strip()
            if current and pdfmetrics.stringWidth(candidate, font, size) > limit:
                parts.append(current)
                current = word
            else:
                current = candidate
        parts.append(current)
        for part in parts:
            if y < 23 * mm:
                pdf.showPage()
                y = height - 18 * mm
            if align == 'right':
                pdf.drawRightString(right, y, part, shaping=True)
            elif align == 'center':
                pdf.drawCentredString(width / 2, y, part, shaping=True)
            else:
                pdf.drawString(left, y, part, shaping=True)
            y -= gap * mm

    def rule():
        nonlocal y
        pdf.setStrokeColor(colors.HexColor('#CBD5D1'))
        pdf.line(left, y, right, y)
        y -= 6 * mm

    def ensure(space):
        nonlocal y
        if y - space < 23 * mm:
            pdf.showPage()
            y = height - 18 * mm
            text(f'{quote.number} · continued', 9, 8)

    money = lambda value: f'BDT {value:,.2f}' if quote.business.show_currency_symbol else f'{value:,.2f}'
    text(quote.business.name, 15, 7, 'center')
    if quote.business.phone:
        text(quote.business.phone, 9, 5, 'center')
    if quote.business.address:
        text(quote.business.address, 9, 6, 'center')
    text('QUOTATION / মূল্য প্রস্তাব', 12, 8, 'center')
    rule()
    text(f'Quotation: {quote.number}')
    text(f'Issued: {quote.issued_at.date().isoformat()}')
    text(f'Valid until: {quote.valid_until.isoformat()}')
    text(f'Customer: {quote.customer_name or "Walk-in Customer"}')
    if quote.customer_phone:
        text(f'Phone: {quote.customer_phone}')
    if quote.customer_address:
        text(f'Address: {quote.customer_address}')
    if quote.delivery_address:
        text(f'Deliver to: {quote.delivery_address}')
    rule()
    for index, row in enumerate(quote.lines.order_by('pk'), 1):
        ensure(14 * mm)
        text(f'{index}. {row.product_name}' + (f' / {row.variant_name}' if row.variant_name else ''), 9, 5)
        text(f'   SKU {row.sku} | {row.quantity:g} {row.unit_name} x {money(row.unit_price)} = {money(row.line_total)}', 8, 6)
    rule()
    text(f'Subtotal: {money(quote.subtotal)}', 9, 5, 'right')
    if quote.discount:
        text(f'Discount: -{money(quote.discount)}', 9, 5, 'right')
    if quote.delivery_fee:
        text(f'Delivery: {money(quote.delivery_fee)}', 9, 5, 'right')
    text(f'TOTAL: {money(quote.total)}', 11, 8, 'right')
    if quote.notes:
        text(f'Notes: {quote.notes}', 9, 6)
    pdf.save()
    return stream.getvalue()
