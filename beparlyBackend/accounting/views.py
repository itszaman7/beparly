from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from accounts.models import BusinessMember
from accounts.views import body, current_member, current_session, error

from .models import AssetDepreciation, BusinessAsset, Contact, ExpenseCategory, IncomeCategory, JournalLine, MoneyAccount, MoneyTransaction, normalize_customer_phone
from .services import (AccountingError, amount, balance, command_uuid, contact_position,
                       create_money_account, depreciate, money_operation, purchase_asset,
                       create_financial_category, reverse, sell_asset, setup_business)
from stockkeeper.services import business_today


def owner(request, business_id):
    session = current_session(request)
    if not session:
        return None, error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return None, error('not_found', 'Business not found.', 404)
    if member.role != BusinessMember.OWNER:
        return None, error('forbidden', 'Only the owner can manage money.', 403)
    return member, None


def parse_date(value):
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise AccountingError('Enter a valid date.') from None


def command(request):
    return command_uuid(request.headers.get('X-Command-ID'))


def serialize_account(item):
    return {'id': str(item.pk), 'name': item.name, 'kind': item.kind,
            'masked_reference': item.masked_reference, 'is_default': item.is_default,
            'is_active': item.is_active, 'balance': str(balance(item.ledger_account)),
            'created_at': item.created_at.isoformat()}


def serialize_txn(item):
    return {'id': str(item.pk), 'kind': item.kind, 'amount': str(item.amount),
            'account_id': str(item.account_id), 'destination_id': str(item.destination_id) if item.destination_id else None,
            'contact_id': str(item.contact_id) if item.contact_id else None, 'note': item.note,
            'event_date': item.event_date.isoformat(), 'created_at': item.created_at.isoformat(),
            'reversed': hasattr(item.journal, 'reversal')}


@csrf_exempt
def money_accounts(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    setup_business(member.business)
    if request.method == 'GET':
        accounts = MoneyAccount.objects.filter(business_id=business_id).select_related('ledger_account').order_by('-created_at', '-id')
        rows = [serialize_account(item) for item in accounts]
        return JsonResponse({'accounts': rows, 'available_money': str(sum((Decimal(row['balance']) for row in rows), Decimal('0')))})
    try:
        data = body(request)
        item = create_money_account(member.business, str(data.get('name', '')).strip(), data.get('kind'),
                                    str(data.get('masked_reference', '')).strip(), command(request))
        return JsonResponse({'account': serialize_account(item)}, status=201)
    except (ValueError, ValidationError, AccountingError) as exc:
        return error('invalid_input', str(exc))


@csrf_exempt
def money_transactions(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    setup_business(member.business)
    if request.method == 'GET':
        rows = MoneyTransaction.objects.filter(business_id=business_id).select_related('journal').order_by('-created_at')[:50]
        return JsonResponse({'transactions': [serialize_txn(item) for item in rows]})
    try:
        data = body(request)
        account = MoneyAccount.objects.filter(business_id=business_id, pk=data.get('account_id')).first()
        if not account:
            raise AccountingError('Choose a money account.')
        destination = MoneyAccount.objects.filter(business_id=business_id, pk=data.get('destination_id')).first() if data.get('destination_id') else None
        contact = Contact.objects.filter(business_id=business_id, pk=data.get('contact_id')).first() if data.get('contact_id') else None
        category = ExpenseCategory.objects.filter(business_id=business_id, pk=data.get('category_id')).first() if data.get('category_id') else None
        income_category = IncomeCategory.objects.filter(business_id=business_id, pk=data.get('category_id')).first() if data.get('category_id') else None
        item = money_operation(member.business, current_session(request).user, command(request),
            data.get('kind'), data.get('amount'), account, destination=destination, contact=contact,
            category=category, income_category=income_category, note=str(data.get('note', '')).strip()[:240], event_date=parse_date(data.get('event_date')))
        return JsonResponse({'transaction': serialize_txn(item)}, status=201)
    except (ValueError, ValidationError, AccountingError) as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'This command conflicts with a posted transaction.', 409)


@csrf_exempt
def reverse_transaction(request, business_id, transaction_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    txn = MoneyTransaction.objects.filter(business_id=business_id, pk=transaction_id).select_related('journal').first()
    if not txn:
        return error('not_found', 'Transaction not found.', 404)
    if txn.journal.source_type != 'money':
        return error('invalid_action', 'Use an asset correction workflow for asset transactions.', 409)
    if txn.kind.endswith('_reversal'):
        return error('invalid_action', 'A correction cannot be reversed from this screen.', 409)
    if txn.kind in ('customer_advance', 'supplier_advance') and txn.contact and (
            Decimal(contact_position(txn.contact)[txn.kind]) < txn.amount):
        return error('invalid_action', 'This advance has been partly refunded. Correct the later refund first.', 409)
    try:
        data = body(request)
        reason = str(data.get('reason', '')).strip()
        if not reason:
            raise AccountingError('Enter a correction reason.')
        with transaction.atomic():
            entry = reverse(txn.journal, current_session(request).user, command(request), reason)
            MoneyTransaction.objects.get_or_create(journal=entry, defaults={
                'business': member.business, 'kind': txn.kind + '_reversal', 'amount': txn.amount,
                'account': txn.account, 'destination': txn.destination, 'contact': txn.contact,
                'note': reason, 'event_date': business_today(member.business),
            })
        return JsonResponse({'reversal_id': str(entry.pk)})
    except (ValueError, ValidationError, AccountingError) as exc:
        return error('invalid_input', str(exc))


@csrf_exempt
def contacts(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    if request.method == 'GET':
        return JsonResponse({'contacts': [serialize_contact(item) for item in Contact.objects.filter(business_id=business_id).order_by('name')[:100]]})
    try:
        data = body(request)
        name = str(data.get('name', '')).strip()
        if len(name) > 160 or type(data.get('is_customer')) is not bool or type(data.get('is_supplier')) is not bool:
            raise AccountingError('Enter a name and choose customer, supplier, or both.')
        phone = normalize_customer_phone(data.get('phone')) if data['is_customer'] and name != 'Walk-in Customer' else str(data.get('phone', '')).strip()[:20]
        customer_type = data.get('customer_type', Contact.REGULAR)
        if customer_type not in dict(Contact.CUSTOMER_TYPE_CHOICES):
            raise AccountingError('Choose Regular or Wholesale customer.')
        item = Contact.objects.create(business=member.business, name=name, phone=phone, customer_type=customer_type,
            address=str(data.get('address', '')).strip()[:255], district=str(data.get('district', '')).strip()[:80],
            area=str(data.get('area', '')).strip()[:100], notes=str(data.get('notes', '')).strip(), created_by=current_session(request).user,
            is_customer=data['is_customer'], is_supplier=data['is_supplier'])
        return JsonResponse({'contact': serialize_contact(item)}, status=201)
    except (ValueError, ValidationError, AccountingError) as exc:
        return error('invalid_input', str(exc))


def serialize_contact(item):
    return {'id': str(item.pk), 'name': item.name, 'phone': item.phone,
            'address': item.address, 'district': item.district, 'area': item.area, 'notes': item.notes, 'customer_type': item.customer_type,
            'is_customer': item.is_customer, 'is_supplier': item.is_supplier, **contact_position(item)}


def contact_detail(request, business_id, contact_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    _, problem = owner(request, business_id)
    if problem:
        return problem
    item = Contact.objects.filter(business_id=business_id, pk=contact_id).first()
    if not item:
        return error('not_found', 'Contact not found.', 404)
    lines = JournalLine.objects.filter(contact=item).select_related('entry', 'account').order_by('-entry__created_at')[:50]
    return JsonResponse({'contact': serialize_contact(item), 'statement': [
        {'date': line.entry.event_date.isoformat(), 'description': line.entry.description,
         'kind': line.account.code, 'debit': str(line.debit), 'credit': str(line.credit)} for line in lines]})


@csrf_exempt
def financial_categories(request, business_id, category_type):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    if category_type not in ('expense', 'income'):
        return error('not_found', 'Category type not found.', 404)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    setup_business(member.business)
    model = ExpenseCategory if category_type == 'expense' else IncomeCategory
    if request.method == 'POST':
        try:
            data = body(request)
            if data.get('type', category_type) != category_type:
                raise AccountingError('Category type does not match this list.')
            item = create_financial_category(member.business, current_session(request).user, data.get('name'), category_type)
            return JsonResponse({'category': {'id': item.pk, 'name': item.name, 'type': category_type}}, status=201)
        except (ValueError, ValidationError, AccountingError) as exc:
            return error('invalid_input', str(exc))
    return JsonResponse({'categories': [{'id': item.pk, 'name': item.name, 'type': category_type} for item in model.objects.filter(business_id=business_id).order_by('name')]})


@csrf_exempt
def expense_categories(request, business_id):
    return financial_categories(request, business_id, 'expense')


@csrf_exempt
def income_categories(request, business_id):
    return financial_categories(request, business_id, 'income')


def serialize_asset(item):
    depreciated = sum((row.amount for row in item.depreciations.all()), 0)
    return {'id': str(item.pk), 'name': item.name, 'cost': str(item.cost),
            'residual_value': str(item.residual_value), 'useful_life_months': item.useful_life_months,
            'in_service_date': item.in_service_date.isoformat(), 'sold_on': item.sold_on.isoformat() if item.sold_on else None,
            'depreciated': str(depreciated), 'book_value': str(item.cost - depreciated)}


@csrf_exempt
def assets(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, problem = owner(request, business_id)
    if problem:
        return problem
    setup_business(member.business)
    if request.method == 'GET':
        return JsonResponse({'assets': [serialize_asset(item) for item in BusinessAsset.objects.filter(business_id=business_id).prefetch_related('depreciations').order_by('-created_at')[:100]]})
    try:
        data = body(request)
        account = MoneyAccount.objects.filter(business_id=business_id, pk=data.get('account_id')).first()
        if not account:
            raise AccountingError('Choose a payment account.')
        item = purchase_asset(member.business, current_session(request).user, command(request),
            str(data.get('name', '')).strip(), data.get('cost'), data.get('residual_value', '0'),
            data.get('useful_life_months'), parse_date(data.get('in_service_date')), account)
        return JsonResponse({'asset': serialize_asset(item)}, status=201)
    except (ValueError, ValidationError, AccountingError) as exc:
        return error('invalid_input', str(exc))


@csrf_exempt
def asset_sale(request, business_id, asset_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    _, problem = owner(request, business_id)
    if problem:
        return problem
    item = BusinessAsset.objects.filter(business_id=business_id, pk=asset_id).first()
    if not item:
        return error('not_found', 'Asset not found.', 404)
    try:
        data = body(request)
        account = MoneyAccount.objects.filter(business_id=business_id, pk=data.get('account_id')).first()
        if not account:
            raise AccountingError('Choose a money account.')
        item = sell_asset(item, current_session(request).user, command(request), data.get('proceeds'), account)
        return JsonResponse({'asset': serialize_asset(item)})
    except (ValueError, ValidationError, AccountingError) as exc:
        return error('invalid_input', str(exc))
