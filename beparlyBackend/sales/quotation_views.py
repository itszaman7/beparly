from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import IntegrityError
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from accounting.services import AccountingError, command_uuid
from accounts.views import body, error
from stockkeeper.services import StockError

from .models import Quotation, QuotationSaleDraft
from .quotations import (QuotationConflict, QuotationError, change_status, complete_draft, convert,
                         duplicate, issue, save_draft, serialize)
from .services import SaleError, serialize_sale
from .views import member_for


def _failure(exc):
    if isinstance(exc, IntegrityError):
        return error('conflict', 'This quotation command conflicts with a saved change. Retry with the original command ID.', 409)
    return error('conflict' if isinstance(exc, QuotationConflict) else 'invalid_input', str(exc),
                 409 if isinstance(exc, QuotationConflict) else 400)


def _quote(business, quote_id):
    return Quotation.objects.filter(business=business, pk=quote_id).select_related('business', 'customer', 'location', 'completed_sale').prefetch_related('lines').first()


@csrf_exempt
def quotations(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if request.method == 'GET':
        query = Quotation.objects.filter(business=member.business).select_related('business', 'location', 'completed_sale')
        search = request.GET.get('search', '').strip()[:100]
        if search:
            query = query.filter(Q(number__icontains=search) | Q(customer_name__icontains=search) | Q(customer_phone__icontains=search))
        try:
            page = max(1, int(request.GET.get('page', 1)))
        except ValueError:
            page = 1
        rows = list(query.order_by('-created_at', '-pk')[(page-1)*30:page*30+1])
        return JsonResponse({'quotations': [serialize(row, lines=False) for row in rows[:30]],
                             'next_page': page+1 if len(rows) > 30 else None})
    try:
        quote = save_draft(member.business, session.user, command_uuid(request.headers.get('X-Command-ID')), body(request))
        return JsonResponse({'quotation': serialize(_quote(member.business, quote.pk))}, status=201)
    except (ValueError, StockError, AccountingError, IntegrityError, ValidationError) as exc:
        return _failure(exc)


@csrf_exempt
def quotation_detail(request, business_id, quote_id):
    if request.method not in ('GET', 'PATCH'):
        return error('method_not_allowed', 'Use GET or PATCH.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    quote = _quote(member.business, quote_id)
    if not quote:
        return error('not_found', 'Quotation not found.', 404)
    if request.method == 'GET':
        return JsonResponse({'quotation': serialize(quote)})
    try:
        updated = save_draft(member.business, session.user, command_uuid(request.headers.get('X-Command-ID')),
                             body(request), quote_id)
        return JsonResponse({'quotation': serialize(_quote(member.business, updated.pk))})
    except (ValueError, StockError, AccountingError, IntegrityError, ValidationError) as exc:
        return _failure(exc)


@csrf_exempt
def quotation_action(request, business_id, quote_id, action):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    if not _quote(member.business, quote_id):
        return error('not_found', 'Quotation not found.', 404)
    try:
        data = body(request)
        command_id = command_uuid(request.headers.get('X-Command-ID'))
        if action == 'issue':
            quote = issue(member.business, session.user, command_id, quote_id, data.get('version'))
        elif action == 'status':
            quote = change_status(member.business, session.user, command_id, quote_id, data.get('status'))
        elif action == 'duplicate':
            quote = duplicate(member.business, session.user, command_id, quote_id)
        elif action == 'convert':
            draft = convert(member.business, session.user, command_id, quote_id)
            return JsonResponse({'sale_draft': {'id': str(draft.pk), 'quotation_id': str(quote_id), 'payload': draft.payload}})
        else:
            return error('not_found', 'Action not found.', 404)
        return JsonResponse({'quotation': serialize(_quote(member.business, quote.pk))})
    except (ValueError, StockError, AccountingError, IntegrityError, ObjectDoesNotExist, ValidationError) as exc:
        return _failure(exc)


@csrf_exempt
def quotation_checkout(request, business_id, draft_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    draft = QuotationSaleDraft.objects.filter(business=member.business, pk=draft_id).first()
    if not draft:
        return error('not_found', 'Sale draft not found.', 404)
    if request.method == 'GET':
        return JsonResponse({'sale_draft': {'id': str(draft.pk), 'quotation_id': str(draft.quotation_id), 'payload': draft.payload}})
    try:
        sale = complete_draft(member.business, session.user, command_uuid(request.headers.get('X-Command-ID')),
                              draft_id, body(request))
        return JsonResponse({'sale': serialize_sale(sale, include_lines=True)}, status=201)
    except (ValueError, StockError, AccountingError, IntegrityError, ObjectDoesNotExist, ValidationError) as exc:
        return _failure(exc)


def quotation_document(request, business_id, quote_id, size):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    member, session, problem = member_for(request, business_id)
    if problem:
        return problem
    quote = _quote(member.business, quote_id)
    if not quote or quote.status == 'draft' or size not in ('a4', 'a5'):
        return error('not_found', 'Issued quotation document not found.', 404)
    from .quotation_documents import render_quotation
    try:
        pdf = render_quotation(quote, size)
    except (ImportError, OSError) as exc:
        return error('server_configuration', str(exc), 503)
    response = HttpResponse(pdf, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{quote.number}-{size}.pdf"'
    return response
