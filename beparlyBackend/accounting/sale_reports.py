"""Sale references shared by report rows and the paginated sale drill-down."""
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db.models import CharField, Exists, OuterRef, Subquery, Value
from django.db.models.functions import Cast, Replace
from django.http import JsonResponse

from accounts.views import error
from sales.models import Sale, SalePayment, SaleReturn
from stockkeeper.services import business_today

from .models import JournalEntry
from .services import AccountingError
from .views import owner, parse_date


def sale_preview(sale):
    lines = list(sale.lines.all())
    return {
        'sale_id': str(sale.pk), 'sale_number': sale.invoice_number,
        'customer_id': str(sale.customer_id) if sale.customer_id else None,
        'customer_name': sale.customer_name_snapshot or (sale.customer.name if sale.customer else 'Walk-in customer'),
        'products': [{'name': line.product_name, 'variant': line.variant_name,
                      'quantity': str(line.quantity), 'unit': line.unit_name}
                     for line in lines[:3]],
        'product_count': len(lines), 'sale_total': str(sale.total),
        'sale_status': sale.status,
    }


def previews(business, sale_ids):
    ids = [value for value in sale_ids if value]
    return {str(sale.pk): sale_preview(sale) for sale in
            Sale.objects.filter(business=business, pk__in=ids).select_related('customer').prefetch_related('lines')}


def entry_sale_ids(business, entries):
    """Resolve journals for sales, returns, collections and their reversals in batches."""
    result = {}
    returns = {}
    payments = []
    for entry in entries:
        original = entry.reverses if entry.reverses_id else entry
        if original.source_type == 'sale':
            result[str(entry.pk)] = original.source_id
        elif original.source_type == 'sale_return':
            returns[str(entry.pk)] = original.source_id
        elif original.source_type in ('sale_collection', 'sale_refund', 'sale_return_refund'):
            payments.append((str(entry.pk), original.pk))
    if returns:
        mapping = {str(row.pk): str(row.sale_id) for row in
                   SaleReturn.objects.filter(sale__business=business, pk__in=returns.values())}
        result.update({entry_id: mapping[return_id] for entry_id, return_id in returns.items() if return_id in mapping})
    if payments:
        mapping = {str(row.journal_id): str(row.sale_id) for row in
                   SalePayment.objects.filter(sale__business=business,
                                              journal_id__in=[journal_id for _, journal_id in payments])}
        mapping.update({str(row.refund_journal_id): str(row.sale_id) for row in
                        SaleReturn.objects.filter(sale__business=business,
                                                  refund_journal_id__in=[journal_id for _, journal_id in payments])})
        result.update({entry_id: mapping[str(journal_id)] for entry_id, journal_id in payments
                       if str(journal_id) in mapping})
    return result


def add_sale_previews_to_entries(rows, entries, business):
    by_entry = entry_sale_ids(business, entries)
    by_sale = previews(business, by_entry.values())
    for row, entry in zip(rows, entries):
        preview = by_sale.get(by_entry.get(str(entry.pk), ''))
        if preview:
            row.update(preview)


def add_sale_previews_to_movements(rows, movements, business):
    by_movement = {}
    return_refs = {}
    for movement in movements:
        if movement.type in ('sale', 'sale_cancellation'):
            by_movement[str(movement.pk)] = str(movement.reference_id)
        elif movement.type == 'sale_return':
            return_refs[str(movement.pk)] = str(movement.reference_id)
    if return_refs:
        mapping = {str(row.pk): str(row.sale_id) for row in
                   SaleReturn.objects.filter(sale__business=business, pk__in=return_refs.values())}
        by_movement.update({movement_id: mapping[return_id] for movement_id, return_id in return_refs.items()
                            if return_id in mapping})
    by_sale = previews(business, by_movement.values())
    for row, movement in zip(rows, movements):
        preview = by_sale.get(by_movement.get(str(movement.pk), ''))
        if preview:
            row.update(preview)


def report_sales(request, business_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    try:
        cutoff = parse_date(request.GET.get('as_of'))
        start = parse_date(request.GET.get('start_date'))
        end = parse_date(request.GET.get('end_date'))
        if cutoff and (start or end):
            raise AccountingError('Choose a date range or an as-of date.')
        if cutoff is None:
            today = business_today(member.business)
            if start is None and end is None:
                start, end = today.replace(day=1), today
            if start is None or end is None or start > end or (end - start).days > 3660:
                raise AccountingError('Choose a valid date range of 10 years or less.')
        try:
            number = int(request.GET.get('page', '1'))
            if not 1 <= number <= 100000:
                raise ValueError
        except ValueError:
            raise AccountingError('Choose a valid page.') from None
        sales = Sale.objects.filter(business=member.business)
        for field in ('product_id', 'variant_id', 'customer_id'):
            if request.GET.get(field):
                sales = sales.filter(**{('lines__' if field != 'customer_id' else '') + field: UUID(request.GET[field])})
        if request.GET.get('location_id'):
            sales = sales.filter(location_id=int(request.GET['location_id']))
        sale_key = Replace(Cast(OuterRef('pk'), output_field=CharField()), Value('-'), Value(''))
        posting = (JournalEntry.objects.filter(business=member.business, source_type='sale')
                   .annotate(source_key=Replace('source_id', Value('-'), Value('')))
                   .filter(source_key=sale_key))
        if cutoff:
            posting = posting.filter(event_date__lte=cutoff)
        else:
            posting = posting.filter(event_date__range=(start, end))
        # The journal existence check excludes drafts and uses the posting event date.
        sales = (sales.alias(has_posting=Exists(posting)).filter(has_posting=True)
                 .annotate(posted_date=Subquery(posting.values('event_date')[:1])).distinct()
                 .select_related('customer').prefetch_related('lines').order_by('-created_at', '-pk'))
        offset = (number - 1) * 25
        records = list(sales[offset:offset + 26])
        return JsonResponse({'start_date': start.isoformat() if start else None,
            'end_date': end.isoformat() if end else None,
            'as_of': cutoff.isoformat() if cutoff else None,
            'rows': [dict(sale_preview(sale), invoice_date=sale.invoice_date.isoformat(),
                          posted_date=sale.posted_date.isoformat())
                     for sale in records[:25]],
            'page': number, 'next_page': number + 1 if len(records) > 25 else None})
    except (AccountingError, ValueError, TypeError, ValidationError) as exc:
        return error('invalid_input', str(exc))
