"""Owner-only, business-scoped report queries. Posted journals are the financial source."""
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Q, Subquery, Sum
from django.http import JsonResponse
from django.utils import timezone

from accounts.views import error
from stockkeeper.models import CostLayer, StockBalance, StockLocation, StockMovement
from stockkeeper.services import business_today
from .models import JournalEntry, JournalLine, LedgerAccount
from .reports import financial_summary
from .sale_reports import add_sale_previews_to_entries, add_sale_previews_to_movements
from .services import AccountingError
from .views import owner, parse_date

ZERO = Decimal('0')
ACTIVITY = {'sales-summary', 'daily-sales', 'money-received', 'expenses', 'purchase-summary'}
INVENTORY = {'stock-sold', 'best-sellers', 'current-stock', 'stock-valuation',
             'wastage-loss', 'expiry', 'stock-movements'}
STATEMENTS = {'profit-loss', 'balance-sheet', 'trial-balance', 'general-ledger'}


def total(query, field):
    return query.aggregate(value=Sum(field))['value'] or ZERO


def dates(request, business, *, balance=False):
    today = business_today(business)
    if balance:
        cutoff = parse_date(request.GET.get('as_of')) or today
        return None, cutoff
    start = parse_date(request.GET.get('start_date'))
    end = parse_date(request.GET.get('end_date'))
    if start is None and end is None:
        start, end = today.replace(day=1), today
    if start is None or end is None or start > end or (end - start).days > 3660:
        raise AccountingError('Choose a valid date range of 10 years or less.')
    return start, end


def page(request):
    try:
        value = int(request.GET.get('page', '1'))
        if not 1 <= value <= 100000:
            raise ValueError
        return value
    except ValueError:
        raise AccountingError('Choose a valid page.') from None


def paged(query, request, serializer, size=50):
    number = page(request)
    rows = list(query[(number - 1) * size:number * size + 1])
    return {'rows': [serializer(row) for row in rows[:size]],
            'next_page': number + 1 if len(rows) > size else None, 'page': number}


def local_window(business, start, end):
    zone = ZoneInfo(business.timezone)
    return (datetime.combine(start, time.min, zone),
            datetime.combine(end + timedelta(days=1), time.min, zone))


def account_sums(business, cutoff):
    lines = (JournalLine.objects.filter(entry__business=business, entry__event_date__lte=cutoff)
             .values('account_id', 'account__code', 'account__name', 'account__type')
             .annotate(debit=Sum('debit'), credit=Sum('credit'))
             .order_by('account__code'))
    return [{'id': row['account__code'], 'name': row['account__name'],
             'type': row['account__type'], 'debit': row['debit'] or ZERO,
             'credit': row['credit'] or ZERO} for row in lines]


def statement(request, business, name, cutoff, start):
    rows = account_sums(business, cutoff)
    debit = sum((r['debit'] for r in rows), ZERO)
    credit = sum((r['credit'] for r in rows), ZERO)
    if name == 'trial-balance':
        result = []
        for row in rows:
            net = row['debit'] - row['credit']
            result.append({'id': row['id'], 'name': row['name'], 'type': row['type'],
                           'debit': str(max(net, ZERO)), 'credit': str(max(-net, ZERO))})
        offset = (page(request) - 1) * 50
        return {'as_of': cutoff.isoformat(), 'rows': result[offset:offset + 50],
                'page': page(request), 'next_page': page(request) + 1 if len(result) > offset + 50 else None,
                'total_debit': str(sum((Decimal(r['debit']) for r in result), ZERO)),
                'total_credit': str(sum((Decimal(r['credit']) for r in result), ZERO)),
                'reconciled': debit == credit}
    if name == 'balance-sheet':
        groups = {'asset': [], 'liability': [], 'equity': []}
        earnings = ZERO
        for row in rows:
            net = row['debit'] - row['credit']
            if row['type'] in groups:
                value = net if row['type'] == 'asset' else -net
                groups[row['type']].append({'id': row['id'], 'name': row['name'], 'amount': str(value)})
            elif row['type'] == 'income':
                earnings -= net
            else:
                earnings -= net
        assets = sum((Decimal(r['amount']) for r in groups['asset']), ZERO)
        liabilities = sum((Decimal(r['amount']) for r in groups['liability']), ZERO)
        equity = sum((Decimal(r['amount']) for r in groups['equity']), ZERO)
        ordered = [dict(item, type=kind) for kind, items in groups.items() for item in items]
        offset = (page(request) - 1) * 50
        return {'as_of': cutoff.isoformat(), 'rows': ordered[offset:offset + 50],
                'page': page(request), 'next_page': page(request) + 1 if len(ordered) > offset + 50 else None,
                'current_earnings': str(earnings), 'assets': str(assets),
                'liabilities': str(liabilities), 'equity': str(equity),
                'reconciled': debit == credit and assets == liabilities + equity + earnings}
    if name == 'profit-loss':
        response = financial_summary(request, business.pk)
        # The same date range and journal calculation are the statement's source.
        import json
        data = json.loads(response.content)
        data['reconciled'] = (Decimal(data['totals']['income']) -
                              Decimal(data['totals']['product_cost']) -
                              Decimal(data['totals']['other_expenses']) ==
                              Decimal(data['totals']['profit_loss']))
        details = data['breakdown']['income'] + data['breakdown']['expenses']
        offset = (page(request) - 1) * 50
        data['rows'] = details[offset:offset + 50]
        data['page'] = page(request)
        data['next_page'] = page(request) + 1 if len(details) > offset + 50 else None
        return data
    account_code = request.GET.get('account_code', '')
    account = LedgerAccount.objects.filter(business=business, code=account_code).first()
    if not account:
        raise AccountingError('Choose an account in this business.')
    normal_credit = account.type in ('liability', 'equity', 'income')
    lines = JournalLine.objects.filter(account=account, entry__business=business, entry__event_date__lte=cutoff)
    opening_lines = lines.filter(entry__event_date__lt=start).aggregate(debit=Sum('debit'), credit=Sum('credit')) if start else {'debit': ZERO, 'credit': ZERO}
    opening_raw = (opening_lines['credit'] or ZERO) - (opening_lines['debit'] or ZERO) if normal_credit else (opening_lines['debit'] or ZERO) - (opening_lines['credit'] or ZERO)
    period = lines.filter(entry__event_date__gte=start) if start else lines
    sums = period.aggregate(debit=Sum('debit'), credit=Sum('credit'))
    period_debit, period_credit = sums['debit'] or ZERO, sums['credit'] or ZERO
    number = page(request)
    offset = (number - 1) * 50
    ordered = period.select_related('entry').order_by('entry__event_date', 'entry__created_at', 'entry_id', 'pk')
    prior = period.filter(pk__in=Subquery(ordered.values('pk')[:offset])).aggregate(debit=Sum('debit'), credit=Sum('credit')) if offset else {'debit': ZERO, 'credit': ZERO}
    running = opening_raw + (((prior['credit'] or ZERO) - (prior['debit'] or ZERO)) if normal_credit else
                             ((prior['debit'] or ZERO) - (prior['credit'] or ZERO)))
    selected = list(ordered[offset:offset + 51])
    detail = []
    for line in selected[:50]:
        running += (line.credit - line.debit) if normal_credit else (line.debit - line.credit)
        entry = line.entry
        detail.append({'id': line.pk, 'journal_id': str(entry.pk), 'event_date': entry.event_date.isoformat(),
                       'source_type': entry.source_type, 'source_id': entry.source_id,
                       'description': entry.description, 'debit': str(line.debit), 'credit': str(line.credit),
                       'running_balance': str(running)})
    add_sale_previews_to_entries(detail, [line.entry for line in selected[:50]], business)
    closing = opening_raw + ((period_credit - period_debit) if normal_credit else (period_debit - period_credit))
    return {'as_of': cutoff.isoformat(), 'start_date': start.isoformat() if start else None,
            'account': {'id': account.code, 'name': account.name, 'type': account.type},
            'opening_balance': str(opening_raw), 'total_debit': str(period_debit),
            'total_credit': str(period_credit), 'closing_balance': str(closing),
            'rows': detail, 'page': number, 'next_page': number + 1 if len(selected) > 50 else None,
            'reconciled': debit == credit}


def activity(request, business, name, start, end):
    base = JournalLine.objects.filter(entry__business=business, entry__event_date__range=(start, end))
    if name in ('sales-summary', 'daily-sales'):
        lines = base.filter(account__type='income').filter(
            Q(entry__source_type__in=('sale', 'sale_return')) |
            Q(entry__source_type='reversal', entry__reverses__source_type__in=('sale', 'sale_return')))
        sign = -1
    elif name == 'money-received':
        lines = base.filter(account__moneyaccount__isnull=False).filter(
            Q(entry__source_type__in=('sale_collection', 'sale_refund', 'sale_return_refund')) |
            Q(entry__source_type='money', entry__moneytransaction__kind__in=('other_income', 'customer_advance', 'customer_advance_refund')) |
            Q(entry__source_type='supplier_operation', entry__supplieroperation__kind__in=('advance_refund', 'payment_refund')) |
            Q(entry__source_type='asset_sale') |
            Q(entry__source_type='reversal', entry__reverses__source_type__in=('sale_collection', 'asset_sale')) |
            Q(entry__source_type='reversal', entry__reverses__source_type='money',
              entry__reverses__moneytransaction__kind__in=('other_income', 'customer_advance', 'customer_advance_refund')))
        sign = 1
    elif name == 'expenses':
        lines = base.filter(account__type='expense').exclude(account__code='COGS')
        sign = 1
    else:
        lines = base.filter(account__code='INVENTORY').filter(
            Q(entry__source_type='purchase') |
            Q(entry__source_type='reversal', entry__reverses__source_type='purchase'))
        sign = 1
    sums = lines.aggregate(debit=Sum('debit'), credit=Sum('credit'))
    debit, credit = sums['debit'], sums['credit']
    amount = (debit or ZERO) - (credit or ZERO) if sign == 1 else (credit or ZERO) - (debit or ZERO)
    if name == 'daily-sales':
        day_rows = (lines.values('entry__event_date').annotate(debit=Sum('debit'), credit=Sum('credit'))
                    .order_by('-entry__event_date'))
        result = paged(day_rows, request, lambda row: {'date': row['entry__event_date'].isoformat(),
            'amount': str((row['credit'] - row['debit']) if sign == -1 else (row['debit'] - row['credit']))})
    else:
        entries = (JournalEntry.objects.filter(pk__in=lines.values('entry_id'))
                   .select_related('reverses').order_by('-event_date', '-created_at', '-pk'))
        number = page(request)
        selected = list(entries[(number - 1) * 50:number * 50 + 1])
        detail = [ {'id': str(entry.pk), 'source_type': entry.source_type,
            'source_id': entry.source_id, 'date': entry.event_date.isoformat(), 'description': entry.description,
            'amount': str(sum(((line.credit - line.debit) if sign == -1 else (line.debit - line.credit)
                for line in entry.lines.filter(pk__in=lines.values('pk'))), ZERO))} for entry in selected[:50]]
        add_sale_previews_to_entries(detail, selected[:50], business)
        result = {'rows': detail, 'page': number, 'next_page': number + 1 if len(selected) > 50 else None}
    response = {'start_date': start.isoformat(), 'end_date': end.isoformat(), 'total': str(amount), **result}
    if name == 'sales-summary':
        import json
        summary = json.loads(financial_summary(request, business.pk).content)
        response['profit_metrics'] = summary['profit_metrics']
        response['totals'] = summary['totals']
        response['reconciled'] = Decimal(summary['profit_metrics']['net_sales']) == amount
    return response


def inventory(request, business, name, start, end, cutoff, location):
    movements = StockMovement.objects.filter(business=business)
    balances = StockBalance.objects.filter(business=business)
    layers = CostLayer.objects.filter(business=business)
    if location:
        movements, balances, layers = (query.filter(location=location) for query in (movements, balances, layers))
    if name in ('current-stock', 'stock-valuation', 'expiry'):
        if cutoff != business_today(business):
            return {'as_of': cutoff.isoformat(), 'available': False,
                    'reason': 'Historical stock balances and FIFO cost layers cannot be reconstructed reliably for this date.'}
        if name == 'expiry':
            balances = balances.filter(batch__expires_on__isnull=False, quantity__gt=0)
            expired = balances.filter(batch__expires_on__lt=cutoff)
            _, upper = local_window(business, cutoff, cutoff)
            recognized = StockMovement.objects.filter(business=business, type='waste',
                batch__expires_on__lt=cutoff, created_at__lt=upper)
            if location:
                recognized = recognized.filter(location=location)
            expired_layers = layers.filter(batch__expires_on__lt=cutoff)
            return {'as_of': cutoff.isoformat(), 'expired_awaiting_disposal': str(total(expired, 'quantity')),
                    'expired_awaiting_disposal_cost': str(sum((layer.remaining_quantity * layer.unit_cost for layer in expired_layers), ZERO)),
                    'recognized_write_off_quantity': str(-total(recognized, 'quantity_change')),
                    'recognized_write_off_cost': str(-total(recognized, 'inventory_cost')),
                    **paged(balances.select_related('product', 'variant', 'batch', 'location').order_by('batch__expires_on', 'pk'), request,
                        lambda row: {'id': row.pk, 'product_id': row.product_id, 'variant_id': row.variant_id,
                            'name': row.product.name, 'variant': row.variant.label, 'location': row.location.name,
                            'expires_on': row.batch.expires_on.isoformat(), 'quantity': str(row.quantity),
                            'status': 'expired' if row.batch.expires_on < cutoff else 'awaiting_expiry'})}
        quantities = balances.values('product_id', 'variant_id', 'product__name', 'variant__label').annotate(quantity=Sum('quantity')).order_by('product__name', 'variant__label')
        result = paged(quantities, request, lambda row: {'product_id': row['product_id'], 'variant_id': row['variant_id'],
            'name': row['product__name'], 'variant': row['variant__label'], 'quantity': str(row['quantity'])})
        result.update({'as_of': cutoff.isoformat(), 'total_quantity': str(total(balances, 'quantity'))})
        if name == 'stock-valuation':
            value = sum((layer.remaining_quantity * layer.unit_cost for layer in layers), ZERO)
            costs = {}
            for layer in layers:
                costs[layer.variant_id] = costs.get(layer.variant_id, ZERO) + layer.remaining_quantity * layer.unit_cost
            for row in result['rows']:
                row['value'] = str(costs.get(row['variant_id'], ZERO))
            ledger_value = total(JournalLine.objects.filter(entry__business=business, entry__event_date__lte=cutoff,
                account__code='INVENTORY'), 'debit') - total(JournalLine.objects.filter(entry__business=business,
                entry__event_date__lte=cutoff, account__code='INVENTORY'), 'credit')
            layer_quantity = sum((layer.remaining_quantity for layer in layers), ZERO)
            result.update({'available': True, 'value': str(value), 'ledger_value': str(ledger_value) if not location else None,
                           'reconciled': value == ledger_value and layer_quantity == total(balances, 'quantity') if not location else
                               layer_quantity == total(balances, 'quantity')})
        return result
    lower, upper = local_window(business, start, end)
    movements = movements.filter(created_at__gte=lower, created_at__lt=upper)
    if name in ('stock-sold', 'best-sellers'):
        movements = movements.filter(type__in=('sale', 'sale_return', 'sale_cancellation'))
    elif name == 'wastage-loss':
        movements = movements.filter(type__in=('waste', 'adjustment'))
    if name == 'best-sellers':
        grouped = (movements.values('product_id', 'variant_id', 'product__name', 'variant__label')
                   .annotate(quantity=Sum('quantity_change'), cost=Sum('inventory_cost')).order_by('quantity', 'product__name'))
        result = paged(grouped, request, lambda row: {'product_id': row['product_id'], 'variant_id': row['variant_id'],
            'name': row['product__name'], 'variant': row['variant__label'],
            'quantity': str(-row['quantity']), 'cost': str(-row['cost'])})
    else:
        number = page(request)
        selected = list(movements.select_related('product', 'variant', 'location')
                        .order_by('-created_at', '-pk')[(number - 1) * 50:number * 50 + 1])
        detail = [{'id': str(row.pk), 'product_id': row.product_id, 'variant_id': row.variant_id,
                'name': row.product.name, 'variant': row.variant.label, 'location': row.location.name,
                'date': timezone.localtime(row.created_at, ZoneInfo(business.timezone)).date().isoformat(),
                'type': row.type, 'reference_id': str(row.reference_id),
                'quantity': str(row.quantity_change), 'cost': str(row.inventory_cost)} for row in selected[:50]]
        add_sale_previews_to_movements(detail, selected[:50], business)
        result = {'rows': detail, 'page': number, 'next_page': number + 1 if len(selected) > 50 else None}
    result.update({'start_date': start.isoformat(), 'end_date': end.isoformat(),
                   'total_quantity': str(total(movements, 'quantity_change')),
                   'total_cost': str(total(movements, 'inventory_cost'))})
    return result


def report(request, business_id, name):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    if name not in ACTIVITY | INVENTORY | STATEMENTS:
        return error('not_found', 'Report not found.', 404)
    try:
        if name in ('sales-summary', 'profit-loss') and request.GET.get('group_by', 'day') not in ('day', 'month', 'year'):
            raise AccountingError('Choose day, month or year grouping.')
        is_balance = name in ('current-stock', 'stock-valuation', 'expiry', 'balance-sheet', 'trial-balance')
        if name == 'general-ledger':
            start = parse_date(request.GET.get('start_date'))
            end = parse_date(request.GET.get('as_of')) or business_today(member.business)
            if start and start > end:
                raise AccountingError('Start date cannot be after cutoff.')
        else:
            start, end = dates(request, member.business, balance=is_balance)
        location = None
        if request.GET.get('location_id'):
            if name not in INVENTORY and name not in ('purchase-summary',):
                raise AccountingError('Location filter is unavailable for this report.')
            location = StockLocation.objects.filter(business=member.business, pk=request.GET['location_id']).first()
            if not location:
                raise AccountingError('Choose a location in this business.')
        if name in ACTIVITY:
            if location:
                raise AccountingError('Location filtering is unavailable for journal activity totals.')
            data = activity(request, member.business, name, start, end)
        elif name in INVENTORY:
            data = inventory(request, member.business, name, start, end, end, location)
        elif name == 'profit-loss':
            data = statement(request, member.business, name, end, start)
        else:
            data = statement(request, member.business, name, end, start)
        return JsonResponse(data)
    except (AccountingError, ValueError) as exc:
        return error('invalid_input', str(exc))
