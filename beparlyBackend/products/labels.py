"""Product/variant/package barcode labels. Sales-order labels live elsewhere."""
from io import BytesIO
from reportlab.graphics.barcode import code128
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas
from sales.quotation_documents import _font


LABEL_PAPERS = {'50x30': (50, 30), '70x40': (70, 40), '2x4': (50.8, 101.6)}


def render_product_labels(product, variant, unit=None, *, paper='50x30', count=1):
    if paper not in LABEL_PAPERS or not 1 <= count <= 100:
        raise ValueError('Choose a valid label paper and quantity.')
    code = (unit.barcode if unit else variant.barcode).strip()
    if not code:
        raise ValueError('Add a barcode to this item before printing labels.')
    width_mm, height_mm = LABEL_PAPERS[paper]
    width, height = width_mm * mm, height_mm * mm
    font = _font()
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(width, height), pageCompression=1)
    pdf.setTitle(f'{product.name} - product barcode')
    name = product.name + (f' / {variant.label}' if variant.label else '')
    unit_name = unit.name if unit else variant.base_unit
    price = unit.selling_price if unit and unit.selling_price is not None else variant.retail_price
    barcode = code128.Code128(code, barWidth=0.33 * mm, barHeight=10 * mm, humanReadable=False)
    scale = min(1, (width - 6 * mm) / barcode.width)
    if scale < 0.55:
        raise ValueError('Barcode is too long for this label size. Choose a larger label.')
    for _ in range(count):
        pdf.setFont(font, 7)
        title = name
        while title and pdfmetrics.stringWidth(title, font, 7) > width - 5 * mm:
            title = title[:-1]
        if title != name:
            title = title[:-1] + '…'
        pdf.drawCentredString(width / 2, height - 5 * mm, title, shaping=True)
        pdf.setFont(font, 6)
        detail = unit_name + (f' · ৳{price:,.2f}' if price is not None else '')
        pdf.drawCentredString(width / 2, height - 9 * mm, detail, shaping=True)
        pdf.saveState()
        pdf.translate((width - barcode.width * scale) / 2, height - 21 * mm)
        pdf.scale(scale, 1)
        barcode.drawOn(pdf, 0, 0)
        pdf.restoreState()
        pdf.setFont(font, 6)
        pdf.drawCentredString(width / 2, height - 24 * mm, code, shaping=True)
        pdf.showPage()
    pdf.save()
    return stream.getvalue()
