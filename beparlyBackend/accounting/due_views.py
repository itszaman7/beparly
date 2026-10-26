"""Historical document aging using linked posted allocations, not mutable paid totals."""
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from accounts.views import body, current_session, error
from purchases.models import OpeningPayable, Purchase, SupplierOperation
from sales.models import Sale, SalePayment, SaleReturn
from stockkeeper.services import business_today
from .models import DueDateChange, JournalEntry, JournalLine
from .report_views import ZERO, page, total
from .sale_reports import previews
from .services import AccountingError, command_uuid
from .views import owner, parse_date


def effective_date(document, cutoff, kind):
    change_filter = {'sale': document} if kind == 'sale' else {'purchase': document}
    revisions = DueDateChange.objects.filter(**change_filter, effective_on__lte=cutoff).order_by('-effective_on', '-created_at', '-pk')
    latest = revisions.first()
    if latest:
        return latest.new_date
    first = DueDateChange.objects.filter(**change_filter).order_by('effective_on', 'created_at', 'pk').first()
    return first.previous_date if first else document.due_date


def due_amount(document, cutoff, kind):
    if kind == 'sale':
        posted = JournalEntry.objects.filter(business=document.business, source_type='sale', source_id=str(document.pk), event_date__lte=cutoff).exists()
        if not posted:
            return ZERO
        if JournalEntry.objects.filter(business=document.business, reverses__source_type='sale',
                                       reverses__source_id=str(document.pk), event_date__lte=cutoff).exists():
            return ZERO
        amount = document.total
        allocations = SalePayment.objects.filter(sale=document, journal__event_date__lte=cutoff)
        amount -= total(allocations.filter(kind='receipt'), 'amount')
        # Executed refunds settle the separate refund liability; they do not recreate AR.
        amount -= total(SaleReturn.objects.filter(sale=document, journal__event_date__lte=cutoff), 'due_reduction')
    else:
        posted = JournalEntry.objects.filter(business=document.business, source_type='purchase', source_id=str(document.pk), event_date__lte=cutoff).exists()
        if not posted:
            return ZERO
        if JournalEntry.objects.filter(business=document.business, reverses__source_type='purchase',
                                       reverses__source_id=str(document.pk), event_date__lte=cutoff).exists():
            return ZERO
        amount = document.total
        for operation in SupplierOperation.objects.filter(purchase=document, journal__event_date__lte=cutoff):
            amount += operation.amount if operation.kind in ('payment_refund', 'allocation_reversal') else -operation.amount
    return max(amount, ZERO)


def due_report(request, business_id, kind):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    try:
        cutoff = parse_date(request.GET.get('as_of')) or business_today(member.business)
        number = page(request)
    except AccountingError as exc:
        return error('invalid_input', str(exc))
    if kind == 'customer':
        documents = Sale.objects.filter(business=member.business).select_related('customer').order_by('created_at', 'pk')
        document_type = 'sale'
        advance_code = 'CUSTOMER_ADVANCE'
    elif kind == 'supplier':
        documents = Purchase.objects.filter(business=member.business).select_related('supplier').order_by('created_at', 'pk')
        document_type = 'purchase'
        advance_code = 'SUPPLIER_ADVANCE'
    else:
        return error('not_found', 'Report not found.', 404)
    rows, buckets = [], {'overdue': ZERO, 'upcoming': ZERO, 'due_date_not_set': ZERO}
    for document in documents.iterator():
        outstanding = due_amount(document, cutoff, document_type)
        if outstanding <= 0:
            continue
        due = effective_date(document, cutoff, document_type)
        bucket = 'due_date_not_set' if due is None else 'overdue' if due < cutoff else 'upcoming'
        buckets[bucket] += outstanding
        contact = document.customer if document_type == 'sale' else document.supplier
        rows.append({'id': str(document.pk), 'document_type': document_type,
                     'number': document.invoice_number if document_type == 'sale' else document.number,
                     'contact_id': str(contact.pk), 'contact_name': contact.name,
                     'due_date': due.isoformat() if due else None, 'bucket': bucket, 'outstanding': str(outstanding)})
    if kind == 'supplier':
        openings = OpeningPayable.objects.filter(business=member.business, journal__event_date__lte=cutoff).select_related('supplier')
        for opening in openings.iterator():
            amount = opening.amount
            for operation in SupplierOperation.objects.filter(opening=opening, journal__event_date__lte=cutoff):
                amount += operation.amount if operation.kind in ('payment_refund', 'allocation_reversal') else -operation.amount
            if amount > 0:
                buckets['due_date_not_set'] += amount
                rows.append({'id': str(opening.pk), 'document_type': 'opening', 'number': 'Opening balance',
                    'contact_id': str(opening.supplier_id), 'contact_name': opening.supplier.name,
                    'due_date': None, 'bucket': 'due_date_not_set', 'outstanding': str(amount)})
    rows.sort(key=lambda row: (row['due_date'] is None, row['due_date'] or '', row['number']))
    advance_lines = JournalLine.objects.filter(entry__business=member.business,
        entry__event_date__lte=cutoff, account__code=advance_code)
    advances = total(advance_lines, 'credit') - total(advance_lines, 'debit')
    if kind == 'supplier':
        advances = -advances
    offset = (number - 1) * 50
    detail = rows[offset:offset + 50]
    if kind == 'customer':
        by_sale = previews(member.business, [row['id'] for row in detail])
        for row in detail:
            if row['id'] in by_sale:
                row.update(by_sale[row['id']])
    return JsonResponse({'as_of': cutoff.isoformat(), 'buckets': {key: str(value) for key, value in buckets.items()},
        'total_outstanding': str(sum(buckets.values(), ZERO)), 'advances': str(advances),
        'rows': detail, 'page': number,
        'next_page': number + 1 if len(rows) > offset + 50 else None})


@csrf_exempt
def reschedule(request, business_id, kind, document_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    model = Sale if kind == 'sale' else Purchase if kind == 'purchase' else None
    if model is None:
        return error('not_found', 'Document type not found.', 404)
    try:
        data = body(request)
        due = parse_date(data.get('due_date'))
        reason = str(data.get('reason') or '').strip()
        if not due or not reason or len(reason) > 240:
            raise AccountingError('Enter a valid due date and reason.')
        command = command_uuid(request.headers.get('X-Command-ID'))
        with transaction.atomic():
            prior = DueDateChange.objects.filter(business=member.business, command_id=command).first()
            if prior:
                if prior.new_date != due or prior.reason != reason or str(prior.sale_id or prior.purchase_id) != str(document_id):
                    raise AccountingError('Retry this command with its original details.')
                change = prior
            else:
                document = model.objects.select_for_update().filter(business=member.business, pk=document_id).first()
                if not document:
                    return error('not_found', 'Document not found.', 404)
                if due_amount(document, business_today(member.business), kind) <= 0:
                    raise AccountingError('This document has no outstanding due to reschedule.')
                change = DueDateChange.objects.create(business=member.business,
                    sale=document if kind == 'sale' else None, purchase=document if kind == 'purchase' else None,
                    previous_date=document.due_date, new_date=due, effective_on=business_today(member.business),
                    reason=reason, actor=current_session(request).user, command_id=command)
                document.due_date = due
                document.save(update_fields=['due_date'])
        return JsonResponse({'change_id': change.pk, 'due_date': change.new_date.isoformat(),
                             'effective_on': change.effective_on.isoformat()})
    except (ValueError, AccountingError) as exc:
        return error('invalid_input', str(exc))
