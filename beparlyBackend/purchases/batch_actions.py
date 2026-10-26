"""Shared, business-scoped batch documents and append-only record notes."""
from io import BytesIO
from uuid import UUID

from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from accounts.models import Business
from accounts.views import body, error
from accounting.services import command_uuid
from audit.models import AuditEvent
from audit.services import record
from sales.models import Sale
from sales.views import member_for as sale_member_for

from .models import Purchase
from .views import access as purchase_access


def _ids(values):
    if not isinstance(values, list) or not 1 <= len(values) <= 25:
        raise ValueError('Choose between 1 and 25 records.')
    try:
        ids = [str(UUID(str(value))) for value in values]
    except (ValueError, TypeError, AttributeError):
        raise ValueError('Choose valid record IDs.') from None
    if len(set(ids)) != len(ids):
        raise ValueError('Choose each record only once.')
    return ids


def _rows(business, entity_type, ids, *, completed=False):
    model = Sale if entity_type == 'sale' else Purchase
    query = model.objects.filter(business=business, pk__in=ids)
    if entity_type == 'sale':
        query = query.select_related('business', 'customer', 'location').prefetch_related(
            'lines', 'payments__account', 'returns')
    else:
        query = query.select_related('business', 'supplier', 'location').prefetch_related('lines')
    found = {str(row.pk): row for row in query}
    for pk in ids:
        row = found.get(pk)
        if row is None:
            raise ValueError(f'Record {pk} was not found in this business.')
        if completed and row.status != 'completed':
            number = row.invoice_number if entity_type == 'sale' else row.number or pk
            raise ValueError(f'{number} is {row.status}; only completed records can be printed.')
    return [found[pk] for pk in ids]


def _merge(documents):
    from pypdf import PdfWriter

    writer = PdfWriter()
    for document in documents:
        writer.append(BytesIO(document))
    output = BytesIO()
    writer.write(output)
    writer.close()
    return output.getvalue()


def _notes(business, actor, entity_type, ids, note, command_id):
    payload = {'record_ids': ids, 'note': note}
    with transaction.atomic():
        Business.objects.select_for_update().get(pk=business.pk)
        prior = list(AuditEvent.objects.filter(business=business, reference_id=command_id,
            action='note_added'))
        if prior:
            if (len(prior) != len(ids) or any(event.entity_type != entity_type or
                    event.changes != payload for event in prior) or
                    {event.entity_id for event in prior} != set(ids)):
                raise ValueError('This command ID was already used with different note details.')
            by_id = {event.entity_id: event for event in prior}
            return [by_id[pk] for pk in ids]
        if AuditEvent.objects.filter(business=business, reference_id=command_id).exists():
            raise ValueError('This command ID was already used for another action.')
        rows = _rows(business, entity_type, ids)
        return [record(business_id=business.pk, actor=actor, entity_type=entity_type,
            entity_id=row.pk, subject=row.invoice_number if entity_type == 'sale' else row.number or str(row.pk),
            action='note_added', changes=payload, reference_id=command_id) for row in rows]


def _response(events):
    return JsonResponse({'notes': [{'record_id': event.entity_id, 'text': event.changes['note'],
        'actor': event.actor.get_full_name() or event.actor.phone if event.actor else 'System',
        'created_at': event.created_at.isoformat()} for event in events]})


@csrf_exempt
def batch_notes(request, business_id, entity_type):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = (sale_member_for if entity_type == 'sale' else purchase_access)(request, business_id)
    if problem:
        return problem
    try:
        data = body(request)
        if set(data) != {'ids', 'note'}:
            raise ValueError('Send record IDs and a note.')
        ids = _ids(data['ids'])
        if not isinstance(data['note'], str):
            raise ValueError('Enter a note as text.')
        note = data['note'].strip()
        if not note or len(note) > 2000:
            raise ValueError('Enter a note of at most 2000 characters.')
        events = _notes(member.business, session.user, entity_type, ids, note,
                        command_uuid(request.headers.get('X-Command-ID')))
        return _response(events)
    except ValueError as exc:
        return error('invalid_input', str(exc))


def record_notes(business, entity_type, record_id):
    return [{'text': item.changes['note'], 'actor': item.actor.get_full_name() or item.actor.phone if item.actor else 'System',
             'created_at': item.created_at.isoformat()}
            for item in AuditEvent.objects.filter(business=business, entity_type=entity_type,
                entity_id=str(record_id), action='note_added').select_related('actor').order_by('created_at', 'pk')]


def batch_document(request, business_id, entity_type, kind):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    if kind not in (('invoice', 'label') if entity_type == 'sale' else ('summary',)):
        return error('not_found', 'Document not found.', 404)
    member, _, problem = (sale_member_for if entity_type == 'sale' else purchase_access)(request, business_id)
    if problem:
        return problem
    try:
        ids = _ids(request.GET.getlist('id'))
        rows = _rows(member.business, entity_type, ids, completed=True)
        if entity_type == 'sale':
            from sales.documents import render_sale_document
            documents = [render_sale_document(row, kind) for row in rows]
        else:
            from .documents import render_purchase_summary
            documents = [render_purchase_summary(row) for row in rows]
        pdf = _merge(documents)
    except ValueError as exc:
        return error('invalid_input', str(exc))
    except ImportError:
        return error('server_configuration', 'PDF documents are not configured.', 503)
    response = HttpResponse(pdf, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{entity_type}-{kind}-batch.pdf"'
    return response
