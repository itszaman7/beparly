import uuid
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError
from django.db.models import DecimalField, Sum, Value
from django.db.models.functions import Coalesce
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt

from accounting.models import Contact, IncomeCategory, MoneyAccount, normalize_customer_phone
from accounting.services import balance, create_financial_category
from accounts.models import BusinessMember
from accounts.views import body, current_member, current_session, error
from stockkeeper.services import StockError, business_today

from .models import Sale, SaleReturn, SaleReturnReceipt
from .services import SaleError, cancel_sale, collect_sale, create_sale, return_sale, serialize_sale
from .return_workflow import receive_credited_goods, decide_inspected_goods, refund_credited_sale
from accounting.services import AccountingError, command_uuid


def member_for(request, business_id):
    session = current_session(request)
    if not session:
        return None, None, error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return None, None, error('not_found', 'Business not found.', 404)
    if member.role != BusinessMember.OWNER and not member.can_post_stock:
        return None, None, error('forbidden', 'You do not have permission to post sales.', 403)
    return member, session, None


SALES_PAGE_SIZE = 100


@csrf_exempt
def sales(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if request.method == 'GET':
        try:
            page = int(request.GET.get('page', '1'))
        except ValueError:
            return error('invalid_input', 'Choose a valid sales page.')
        if page < 1:
            return error('invalid_input', 'Choose a valid sales page.')
        rows = Sale.objects.filter(business=member.business)
        if request.GET.get('customer_id'):
            try:
                customer_id = uuid.UUID(request.GET['customer_id'])
            except (ValueError, AttributeError):
                return error('invalid_input', 'Choose a valid customer.')
            rows = rows.filter(customer_id=customer_id)
        start = (page - 1) * SALES_PAGE_SIZE
        rows = list(rows.select_related('customer', 'location').prefetch_related(
            'lines', 'payments__account', 'returns__lines__receipts',
            'returns__refund_payments', 'returns__refund_account').order_by('-created_at', '-pk')[start:start + SALES_PAGE_SIZE + 1])
        return JsonResponse({'sales': [serialize_sale(row, include_lines=True) for row in rows[:SALES_PAGE_SIZE]],
            'next_page': page + 1 if len(rows) > SALES_PAGE_SIZE else None})
    try:
        command_id = command_uuid(request.headers.get('X-Command-ID'))
        sale = create_sale(member.business, session.user, command_id, body(request))
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True)}, status=201)
    except (ValueError, StockError, AccountingError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This sale conflicts with a posted transaction. Retry with the original command ID.', 409)


def sale_command_status(request, business_id, command_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    sale = Sale.objects.filter(business=member.business, command_id=command_id)
    if member.role != BusinessMember.OWNER:
        sale = sale.filter(actor=session.user)
    sale = sale.select_related('customer', 'location').prefetch_related(
        'lines', 'payments__account', 'returns__lines__receipts',
        'returns__refund_payments', 'returns__refund_account').first()
    if not sale:
        return error('not_found', 'No confirmed sale has this command ID.', 404)
    return JsonResponse({'status': 'confirmed', 'request_hash': sale.request_hash,
                         'sale': serialize_sale(sale, include_lines=True)})


def sales_hub_summary(request, business_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    today = business_today(member.business)
    start = today - timedelta(days=6)
    amounts = {start + timedelta(days=day): {'amount': Decimal('0'), 'count': 0} for day in range(7)}
    returned = Coalesce(Sum('returns__amount'), Value(Decimal('0.00')),
                        output_field=DecimalField(max_digits=18, decimal_places=2))
    rows = (Sale.objects.filter(business=member.business, status='completed')
            .values('id', 'invoice_date', 'total', 'paid').annotate(returned=returned))
    count, collected, due = 0, Decimal('0'), Decimal('0')
    for sale in rows:
        net = sale['total'] - sale['returned']
        count += 1
        collected += sale['paid']
        due += max(Decimal('0'), net - sale['paid'])
        if sale['invoice_date'] in amounts:
            amounts[sale['invoice_date']]['amount'] += net
            amounts[sale['invoice_date']]['count'] += 1
    return JsonResponse({'completed_sales': count, 'collected_against_sales': str(collected),
                         'customer_due': str(due), 'last_seven_days': [
                             {'date': day.isoformat(), 'amount': str(value['amount']), 'count': value['count']}
                             for day, value in amounts.items()]})


@csrf_exempt
def sales_options(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if request.method == 'GET':
        accounts = MoneyAccount.objects.filter(business=member.business, is_active=True).select_related('ledger_account').order_by('-is_default', 'name')
        contacts = Contact.objects.filter(business=member.business, is_customer=True, is_active=True).order_by('name') if request.GET.get('include_contacts') != 'false' else []
        categories = IncomeCategory.objects.filter(business=member.business).order_by('name')
        return JsonResponse({'accounts': [{'id': str(item.pk), 'name': item.name, 'kind': item.kind,
            'masked_reference': item.masked_reference, 'is_default': item.is_default, 'is_active': item.is_active,
            'balance': str(balance(item.ledger_account)), 'created_at': item.created_at.isoformat()} for item in accounts],
            'contacts': [{'id': str(item.pk), 'name': item.name, 'phone': item.phone, 'customer_type': item.customer_type, 'is_customer': True, 'is_supplier': item.is_supplier,
                'customer_advance': '0', 'supplier_advance': '0', 'to_collect': '0', 'to_pay': '0'} for item in contacts],
            'categories': [{'id': item.pk, 'name': item.name} for item in categories]})
    try:
        data = body(request)
        category = create_financial_category(member.business, session.user, data.get('name'), 'income')
        return JsonResponse({'category': {'id': category.pk, 'name': category.name}}, status=201)
    except (ValueError, AccountingError) as exc:
        return error('invalid_input', str(exc))


@csrf_exempt
def sales_customers(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if request.method == 'GET':
        from django.db.models import Q
        query = Contact.objects.filter(business=member.business, is_customer=True, is_active=True)
        search = request.GET.get('search', '').strip()[:100]
        if search:
            query = query.filter(Q(name__icontains=search) | Q(phone__icontains=search))
        try:
            page = max(1, int(request.GET.get('page', '1')))
        except ValueError:
            page = 1
        rows = list(query.order_by('name', 'pk')[(page - 1) * 25:page * 25 + 1])
        return JsonResponse({'customers': [{'id': str(item.pk), 'name': item.name, 'phone': item.phone,
            'address': item.address, 'area': item.area, 'district': item.district} for item in rows[:25]],
            'next_page': page + 1 if len(rows) > 25 else None})
    try:
        data = body(request)
        phone = normalize_customer_phone(data.get('phone'))
        name = str(data.get('name', '')).strip()[:160]
        customer = Contact.objects.filter(business=member.business, phone=phone, is_customer=True).first()
        if customer:
            return JsonResponse({'customer': {'id': str(customer.pk), 'name': customer.name or customer.phone, 'phone': customer.phone}, 'existing': True})
        customer = Contact.objects.create(business=member.business, phone=phone, name=name, customer_type=Contact.REGULAR, is_customer=True,
            is_supplier=False, address=str(data.get('address', '')).strip()[:255], district=str(data.get('district', '')).strip()[:80],
            area=str(data.get('area', '')).strip()[:100], notes=str(data.get('notes', '')).strip(), created_by=session.user)
        return JsonResponse({'customer': {'id': str(customer.pk), 'name': customer.name or customer.phone, 'phone': customer.phone}, 'existing': False}, status=201)
    except (ValueError, AccountingError, ValidationError) as exc:
        return error('invalid_input', str(exc))


@csrf_exempt
def sale_detail(request, business_id, sale_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    sale = Sale.objects.filter(business=member.business, pk=sale_id).select_related('customer').prefetch_related(
        'lines', 'payments__account', 'returns__lines__receipts',
        'returns__refund_payments', 'returns__refund_account').first()
    if not sale:
        return error('not_found', 'Sale not found.', 404)
    if request.method == 'GET':
        from purchases.batch_actions import record_notes
        result = serialize_sale(sale, include_lines=True)
        result['added_notes'] = record_notes(member.business, 'sale', sale.pk)
        return JsonResponse({'sale': result})
    try:
        data = body(request)
        if set(data) != {'amount', 'account_id'}:
            raise SaleError('Send an amount and payment account.')
        account = MoneyAccount.objects.filter(business=member.business, pk=data['account_id']).first()
        if not account:
            raise SaleError('Choose a payment account in this business.')
        payment = collect_sale(sale, session.user, command_uuid(request.headers.get('X-Command-ID')), data['amount'], account)
        sale.refresh_from_db()
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True), 'payment_id': str(payment.pk)}, status=201)
    except (ValueError, AccountingError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This payment command was already used.', 409)


@csrf_exempt
def sale_cancel(request, business_id, sale_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if member.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the owner can cancel a draft sale.', 403)
    sale = Sale.objects.filter(business=member.business, pk=sale_id).first()
    if not sale:
        return error('not_found', 'Sale not found.', 404)
    try:
        data = body(request)
        if set(data) != {'reason'}:
            raise SaleError('Enter a reason for cancelling this sale.')
        sale = cancel_sale(sale, session.user, command_uuid(request.headers.get('X-Command-ID')), data['reason'])
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True)})
    except SaleError as exc:
        return error('invalid_action', str(exc), 409)
    except (ValueError, AccountingError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This sale was already cancelled.', 409)


@csrf_exempt
def sale_returns(request, business_id, sale_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if member.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the owner can issue a sale credit.', 403)
    sale = Sale.objects.filter(business=member.business, pk=sale_id).first()
    if not sale:
        return error('not_found', 'Sale not found.', 404)
    try:
        data = body(request)
        if set(data) - {'reason', 'lines', 'credit_delivery_fee'}:
            raise SaleError('Send a reason, credited items and optional delivery credit.')
        sale_return = return_sale(sale, session.user, command_uuid(request.headers.get('X-Command-ID')), data)
        sale.refresh_from_db()
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True), 'return_id': str(sale_return.pk)}, status=201)
    except (ValueError, ValidationError, AccountingError, StockError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This return conflicts with a posted transaction. Retry with the original command ID.', 409)


@csrf_exempt
def sale_return_receipt(request, business_id, sale_id, return_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    credit = SaleReturn.objects.filter(pk=return_id, sale_id=sale_id,
        sale__business=member.business).select_related('sale').first()
    if not credit:
        return error('not_found', 'Sale credit not found.', 404)
    try:
        receipt = receive_credited_goods(credit, session.user,
            command_uuid(request.headers.get('X-Command-ID')), body(request))
        credit.sale.refresh_from_db()
        return JsonResponse({'sale': serialize_sale(credit.sale, include_lines=True),
            'receipt_id': str(receipt.pk)}, status=201)
    except (ValueError, ValidationError, AccountingError, StockError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This goods receipt conflicts with a posted command.', 409)


@csrf_exempt
def sale_return_disposition(request, business_id, sale_id, return_id, receipt_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if member.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the owner can finalize inspected returned goods.', 403)
    receipt = SaleReturnReceipt.objects.filter(pk=receipt_id,
        return_line__sale_return_id=return_id,
        return_line__sale_return__sale_id=sale_id,
        business=member.business).select_related('return_line__sale_return__sale').first()
    if not receipt:
        return error('not_found', 'Inspection receipt not found.', 404)
    try:
        decision = decide_inspected_goods(receipt, session.user,
            command_uuid(request.headers.get('X-Command-ID')), body(request))
        sale = receipt.return_line.sale_return.sale
        sale.refresh_from_db()
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True),
            'disposition_id': str(decision.pk)}, status=201)
    except (ValueError, ValidationError, AccountingError, StockError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This inspection decision conflicts with a posted command.', 409)


@csrf_exempt
def sale_return_refund(request, business_id, sale_id, return_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if member.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the owner can confirm an executed refund.', 403)
    credit = SaleReturn.objects.filter(pk=return_id, sale_id=sale_id,
        sale__business=member.business).select_related('sale').first()
    if not credit:
        return error('not_found', 'Sale credit not found.', 404)
    try:
        refund = refund_credited_sale(credit, session.user,
            command_uuid(request.headers.get('X-Command-ID')), body(request))
        credit.sale.refresh_from_db()
        return JsonResponse({'sale': serialize_sale(credit.sale, include_lines=True),
            'refund_id': str(refund.pk)}, status=201)
    except (ValueError, ValidationError, AccountingError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This refund conflicts with a posted command.', 409)


def sale_document(request, business_id, sale_id, kind):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    if kind not in ('invoice', 'receipt', 'label'):
        return error('not_found', 'Document not found.', 404)
    paper = request.GET.get('paper')
    if kind != 'label' and paper and paper not in (('A4', 'A5') if kind == 'invoice' else ('58mm', '80mm')):
        return error('invalid_input', 'Choose a supported paper size.')
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    sale = (Sale.objects.filter(business=member.business, pk=sale_id, status='completed')
            .select_related('business', 'customer', 'location').prefetch_related('lines', 'payments__account').first())
    if not sale:
        return error('not_found', 'Active sale not found.', 404)
    try:
        from .documents import render_sale_document
        pdf = render_sale_document(sale, kind, paper)
    except ImportError:
        return error('server_configuration', 'PDF documents are not configured.', 503)
    response = HttpResponse(pdf, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{sale.invoice_number}-{kind}.pdf"'
    return response
