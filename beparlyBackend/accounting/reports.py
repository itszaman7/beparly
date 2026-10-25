from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Q, Sum
from django.http import JsonResponse

from .models import JournalLine
from .views import owner, parse_date
from .services import AccountingError
from accounts.views import error
from stockkeeper.services import business_today


ZERO = Decimal('0')
FIELDS = ('income', 'product_cost', 'other_expenses', 'profit_loss')


def empty_amounts():
    return {field: ZERO for field in FIELDS}


def serialized(amounts):
    return {field: str(amounts[field]) for field in FIELDS}


def financial_summary(request, business_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    group_by = request.GET.get('group_by', 'day')
    if group_by not in ('day', 'month', 'year'):
        return error('invalid_input', 'Choose day, month or year grouping.')
    try:
        today = business_today(member.business)
        start = parse_date(request.GET.get('start_date'))
        end = parse_date(request.GET.get('end_date'))
        if start is None and end is None:
            start = today.replace(day=1, month=1 if group_by in ('month', 'year') else today.month)
            end = today
        elif start is None or end is None:
            raise AccountingError('Enter both start and end dates.')
        if start > end:
            raise AccountingError('Start date cannot be after end date.')
        if (end - start).days > 3660:
            raise AccountingError('Choose a date range of 10 years or less.')
    except AccountingError as exc:
        return error('invalid_input', str(exc))

    def period(day):
        return day.replace(month=1, day=1) if group_by == 'year' else day.replace(day=1) if group_by == 'month' else day

    periods = {}
    cursor = period(start)
    final = period(end)
    while cursor <= final:
        periods[cursor] = empty_amounts()
        if cursor == final:
            break
        if group_by == 'day':
            cursor += timedelta(days=1)
        elif group_by == 'month':
            cursor = date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)
        else:
            cursor = date(cursor.year + 1, 1, 1)

    breakdown = {'income': {}, 'expenses': {}}
    sales_lines = JournalLine.objects.filter(entry__business=member.business,
        entry__event_date__range=(start, end), account__type='income').filter(
        Q(entry__source_type__in=('sale', 'sale_return')) |
        Q(entry__source_type='reversal', entry__reverses__source_type__in=('sale', 'sale_return')))
    sales_amounts = sales_lines.aggregate(debit=Sum('debit'), credit=Sum('credit'))
    sales_income = (sales_amounts['credit'] or ZERO) - (sales_amounts['debit'] or ZERO)
    periods_with_activity = set()
    lines = (JournalLine.objects.filter(entry__business=member.business,
        entry__event_date__range=(start, end), account__type__in=('income', 'expense'))
        .values('entry__event_date', 'account_id', 'account__code', 'account__name', 'account__type')
        .annotate(debit_total=Sum('debit'), credit_total=Sum('credit')))
    for line in lines:
        periods_with_activity.add(period(line['entry__event_date']))
        kind = line['account__type']
        value = (line['credit_total'] - line['debit_total']) if kind == 'income' else (line['debit_total'] - line['credit_total'])
        field = 'income' if kind == 'income' else 'product_cost' if line['account__code'] == 'COGS' else 'other_expenses'
        periods[period(line['entry__event_date'])][field] += value
        group = breakdown['income' if kind == 'income' else 'expenses']
        account_id = line['account_id']
        if account_id not in group:
            group[account_id] = {'id': line['account__code'], 'name': line['account__name'],
                                 'type': field, 'amount': ZERO}
        group[account_id]['amount'] += value

    totals = empty_amounts()
    rows = []
    for day, amounts in periods.items():
        amounts['profit_loss'] = amounts['income'] - amounts['product_cost'] - amounts['other_expenses']
        for field in FIELDS:
            totals[field] += amounts[field]
        rows.append({'period': day.isoformat(), 'has_activity': day in periods_with_activity, **serialized(amounts)})
    return JsonResponse({
        'start_date': start.isoformat(), 'end_date': end.isoformat(), 'group_by': group_by,
        'rows': rows, 'totals': serialized(totals), 'profit_metrics': {'net_sales': str(sales_income),
            'other_income': str(totals['income'] - sales_income),
            'gross_profit': str(sales_income - totals['product_cost'])},
        'breakdown': {key: [dict(id=item['id'], name=item['name'], type=item['type'],
                                amount=str(item['amount'])) for item in sorted(group.values(), key=lambda row: (row['name'], row['id']))]
                      for key, group in breakdown.items()},
    })
