from io import BytesIO
from decimal import Decimal

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


def _money(value, show_currency_symbol=True):
    amount = f'{Decimal(value):,.2f}'
    return f'BDT {amount}' if show_currency_symbol else amount


def render_sale_document(sale, kind):
    thermal = kind == 'receipt'
    width = 80 * mm if thermal else A4[0]
    height = 220 * mm if thermal else A4[1]
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(width, height))
    returned = sum((row.amount for row in sale.returns.all()), Decimal('0'))
    net_total = sale.total - returned
    show_currency_symbol = sale.business.show_currency_symbol
    money = lambda value: _money(value, show_currency_symbol)
    left = 7 * mm if thermal else 18 * mm
    right = width - left
    y = height - (8 * mm if thermal else 20 * mm)

    def line(text='', size=9, bold=False, gap=5, align='left'):
        nonlocal y
        pdf.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
        if align == 'center':
            pdf.drawCentredString(width / 2, y, text)
        elif align == 'right':
            pdf.drawRightString(right, y, text)
        else:
            pdf.drawString(left, y, text)
        y -= gap * mm

    def rule():
        nonlocal y
        pdf.setStrokeColorRGB(0.75, 0.78, 0.77)
        pdf.line(left, y + 2 * mm, right, y + 2 * mm)
        y -= 2 * mm

    if sale.business.logo:
        try:
            logo_width = 24 * mm if thermal else 30 * mm
            logo_height = 16 * mm
            pdf.drawImage(ImageReader(sale.business.logo.path), (width - logo_width) / 2, y - logo_height,
                          width=logo_width, height=logo_height, preserveAspectRatio=True, mask='auto')
            y -= logo_height + 3 * mm
        except (OSError, ValueError):
            pass
    line(sale.business.name, 15 if not thermal else 12, True, 7, 'center')
    if sale.business.phone:
        line(sale.business.phone, 9, False, 4, 'center')
    if sale.business.address:
        line(sale.business.address, 9, False, 5, 'center')
    if not thermal:
        line('SALES INVOICE', 13, True, 8, 'center')
    line(f'Invoice: {sale.invoice_number}', 9, False, 4)
    line(f'Date: {sale.invoice_date.isoformat()}', 9, False, 5)
    customer = sale.customer_name_snapshot or 'Walk-in Customer'
    if customer != 'Walk-in Customer' or not thermal:
        line(f'Customer: {customer}', 9, False, 4)
    if sale.customer_phone_snapshot and not thermal:
        line(f'Phone: {sale.customer_phone_snapshot}', 9, False, 4)
    address = sale.customer_address_snapshot or {}
    if not thermal and any(address.values()):
        line('Address: ' + ', '.join(str(value) for value in address.values() if value), 9, False, 5)
    if sale.delivery_address.get('text'):
        line('Deliver to: ' + sale.delivery_address['text'][:90], 8, False, 5)
    rule()
    if not thermal:
        pdf.setFont('Helvetica-Bold', 8)
        pdf.drawString(left, y, 'Product')
        pdf.drawRightString(right - 46 * mm, y, 'Qty')
        pdf.drawRightString(right - 22 * mm, y, 'Price')
        pdf.drawRightString(right, y, 'Total')
        y -= 6 * mm
    for item in sale.lines.all():
        name = item.product_name + (f' / {item.variant_name}' if item.variant_name else '')
        if item.sku and not thermal:
            name += f' [{item.sku}]'
        if thermal:
            line(name[:32], 8, True, 4)
            line(f'{item.quantity:g} x {money(item.unit_price)} = {money(item.line_total)}', 8, False, 5)
        else:
            pdf.setFont('Helvetica', 8)
            pdf.drawString(left, y, name[:38])
            pdf.drawRightString(right - 46 * mm, y, f'{item.quantity:g}')
            pdf.drawRightString(right - 22 * mm, y, money(item.unit_price))
            pdf.drawRightString(right, y, money(item.line_total))
            y -= 6 * mm
    rule()
    line(f'Subtotal: {money(sale.subtotal)}', 9, False, 5, 'right')
    if sale.discount:
        line(f'Discount: -{money(sale.discount)}', 9, False, 5, 'right')
    if sale.delivery_fee:
        line(f'Delivery: {money(sale.delivery_fee)}', 9, False, 5, 'right')
    if returned:
        line(f'Original total: {money(sale.total)}', 9, False, 5, 'right')
        line(f'Returned items: -{money(returned)}', 9, False, 5, 'right')
    line(f'{"CURRENT TOTAL" if returned else "TOTAL"}: {money(net_total)}', 11, True, 7, 'right')
    line(f'Paid: {money(sale.paid)}', 9, False, 5, 'right')
    line(f'Due: {money(net_total - sale.paid)}', 10, True, 7, 'right')
    accounts = ', '.join(payment.account.name for payment in sale.payments.all() if payment.kind == 'receipt')
    if accounts:
        line(f'Payment: {accounts}', 8, False, 5)
    if sale.price_tier == 'wholesale' and net_total > sale.paid:
        line('Credit sale — payment due from customer.', 9, True, 6)
    if sale.notes and not thermal:
        line('Notes: ' + sale.notes[:160], 8, False, 7)
    line('Thank you for your business.', 8, False, 6, 'center')
    if not thermal:
        line('Authorized signature: ____________________', 9, False, 8)
    pdf.save()
    return output.getvalue()
