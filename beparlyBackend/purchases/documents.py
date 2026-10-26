"""Internal purchase record PDF; it is never represented as a supplier invoice."""
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from sales.documents import _wrap
from sales.quotation_documents import _font


def render_purchase_summary(purchase):
    font = _font()
    width, height = A4
    left, right = 18 * mm, width - 18 * mm
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4, pageCompression=1)
    pdf.setTitle(f'{purchase.number} - Internal purchase summary')
    y = height - 19 * mm

    def draw(value, x=left, size=9):
        nonlocal y
        for line in _wrap(value, font, size, right - x):
            pdf.setFont(font, size)
            pdf.setFillColor(colors.HexColor('#17231F'))
            pdf.drawString(x, y, line, shaping=True)
            y -= (size + 6)

    def space(needed=25 * mm):
        nonlocal y
        if y >= needed:
            return
        pdf.showPage()
        y = height - 18 * mm
        draw(f'{purchase.number} - Internal purchase summary (continued)', size=9)
        y -= 7 * mm

    draw('INTERNAL PURCHASE SUMMARY', size=15)
    draw('Internal business record - not a supplier-issued invoice', size=9)
    y -= 6 * mm
    draw(f'Business: {purchase.business.name}')
    draw(f'Purchase: {purchase.number}    Date: {(purchase.completed_at or purchase.created_at).date()}')
    draw(f'Supplier: {purchase.supplier_name or purchase.supplier.name}')
    draw(f'Supplier phone: {purchase.supplier_phone or purchase.supplier.phone}')
    draw(f'Supplier address: {purchase.supplier_address or purchase.supplier.address}')
    draw(f'Location: {purchase.location_name or purchase.location.name}')
    y -= 5 * mm
    draw('PRODUCT / VARIANT | QUANTITY | UNIT COST | LINE TOTAL', size=8)
    pdf.setStrokeColor(colors.HexColor('#CED9D5'))
    pdf.line(left, y + 5, right, y + 5)
    for line in purchase.lines.select_related('product', 'variant', 'unit', 'batch'):
        space()
        draw(f'{line.product_name or line.product.name} / {line.variant_name or line.variant.label}', size=9)
        draw(f'SKU {line.sku or line.variant.sku}  |  {line.quantity} {line.unit_name or line.variant.base_unit}  |  '
             f'BDT {line.unit_cost:,.4f}  |  BDT {line.line_total:,.2f}', size=8)
        if line.lot_code:
            draw(f'Lot: {line.lot_code}', size=8)
        y -= 3 * mm
    space(35 * mm)
    pdf.line(left, y + 7, right, y + 7)
    draw(f'Total: BDT {purchase.total:,.2f}')
    draw(f'Paid: BDT {purchase.paid:,.2f}')
    draw(f'Due: BDT {purchase.total - purchase.paid:,.2f}')
    if purchase.due_date:
        draw(f'Due date: {purchase.due_date}')
    if purchase.notes:
        space(25 * mm)
        draw('Original purchase notes:')
        draw(purchase.notes)
    pdf.save()
    return output.getvalue()
