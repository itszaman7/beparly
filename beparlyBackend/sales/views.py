from django.db import IntegrityError
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt

from accounting.models import Contact, IncomeCategory, MoneyAccount, normalize_customer_phone
from accounting.services import balance, create_financial_category
from accounts.models import BusinessMember
from accounts.views import body, current_member, current_session, error
from stockkeeper.services import StockError

from .models import Sale
from .services import SaleError, cancel_sale, collect_sale, create_sale, serialize_sale
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


@csrf_exempt
def sales(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if request.method == 'GET':
        rows = Sale.objects.filter(business=member.business).select_related('customer', 'location').prefetch_related('lines', 'payments').order_by('-created_at')[:100]
        return JsonResponse({'sales': [serialize_sale(row, include_lines=True) for row in rows]})
    try:
        command_id = command_uuid(request.headers.get('X-Command-ID'))
        sale = create_sale(member.business, session.user, command_id, body(request))
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True)}, status=201)
    except (ValueError, StockError, AccountingError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This sale conflicts with a posted transaction. Retry with the original command ID.', 409)


@csrf_exempt
def sales_options(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if request.method == 'GET':
        accounts = MoneyAccount.objects.filter(business=member.business, is_active=True).select_related('ledger_account').order_by('-is_default', 'name')
        contacts = Contact.objects.filter(business=member.business, is_customer=True, is_active=True).order_by('name')
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
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
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
    sale = Sale.objects.filter(business=member.business, pk=sale_id).select_related('customer').first()
    if not sale:
        return error('not_found', 'Sale not found.', 404)
    if request.method == 'GET':
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True)})
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
    sale = Sale.objects.filter(business=member.business, pk=sale_id).first()
    if not sale:
        return error('not_found', 'Sale not found.', 404)
    try:
        data = body(request)
        if set(data) != {'reason'}:
            raise SaleError('Enter a reason for cancelling this sale.')
        sale = cancel_sale(sale, session.user, command_uuid(request.headers.get('X-Command-ID')), data['reason'])
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True)})
    except (ValueError, AccountingError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This sale was already cancelled.', 409)


def sale_document(request, business_id, sale_id, kind):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    if kind not in ('invoice', 'receipt'):
        return error('not_found', 'Document not found.', 404)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    sale = (Sale.objects.filter(business=member.business, pk=sale_id, status='completed')
            .select_related('business', 'customer', 'location').prefetch_related('lines', 'payments__account').first())
    if not sale:
        return error('not_found', 'Active sale not found.', 404)
    try:
        from .documents import render_sale_document
        pdf = render_sale_document(sale, kind)
    except ImportError:
        return error('server_configuration', 'PDF documents are not configured.', 503)
    response = HttpResponse(pdf, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{sale.invoice_number}-{kind}.pdf"'
    return response
