import uuid
from io import BytesIO

from PIL import Image, UnidentifiedImageError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.dateparse import parse_date

from accounting.models import Contact, JournalLine, MoneyAccount
from accounting.services import AccountingError, balance, command_uuid, contact_position
from accounts.models import BusinessMember
from accounts.views import body, current_member, current_session, error
from audit.services import record
from stockkeeper.services import StockError

from .models import OpeningPayable, Purchase, SupplierOperation
from .services import (PurchaseError, cancel_purchase, complete_purchase, create_supplier, purchase_data,
                       save_draft, supplier_data, supplier_operation, update_supplier)


def access(request, business_id):
    session = current_session(request)
    if not session:
        return None, None, error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return None, None, error('not_found', 'Business not found.', 404)
    if member.role != BusinessMember.OWNER and not member.can_manage_purchases:
        return None, None, error('forbidden', 'You cannot manage purchases.', 403)
    return member, session, None


def invalid(exc):
    return error('invalid_input', str(exc))


def page_number(request):
    try:
        value = int(request.GET.get('page', '1'))
    except ValueError:
        raise PurchaseError('Choose a valid page.') from None
    if not 1 <= value <= 100000:
        raise PurchaseError('Choose a valid page.')
    return value


def page(rows, number, size=25):
    start = (number - 1) * size
    items = list(rows[start:start + size + 1])
    return items[:size], number + 1 if len(items) > size else None


def payment_accounts(request, business_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    member, _, problem = access(request, business_id)
    if problem:
        return problem
    rows = MoneyAccount.objects.filter(business=member.business, is_active=True,
                                       ledger_account__is_active=True).select_related('ledger_account').order_by('-is_default', 'name', 'id')
    return JsonResponse({'accounts': [{'id': str(item.pk), 'name': item.name, 'kind': item.kind,
        'masked_reference': item.masked_reference, 'is_default': item.is_default, 'is_active': True,
        'balance': str(balance(item.ledger_account))}
        for item in rows]})


@csrf_exempt
def suppliers(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    try:
        if request.method == 'GET':
            rows = Contact.objects.filter(business=member.business, is_supplier=True, is_active=True).select_related('payable_account').order_by('name', 'id')
            search = request.GET.get('search', '').strip()[:100]
            if search:
                rows = rows.filter(Q(name__icontains=search) | Q(phone__icontains=search))
            items, next_page = page(rows, page_number(request))
            return JsonResponse({'suppliers': [supplier_data(item) for item in items], 'next_page': next_page})
        supplier = create_supplier(member.business, session.user, body(request), command_uuid(request.headers.get('X-Command-ID')))
        return JsonResponse({'supplier': supplier_data(supplier)}, status=201)
    except (ValueError, StockError, AccountingError, ValidationError) as exc:
        return invalid(exc)
    except IntegrityError:
        return error('conflict', 'Supplier command conflicted. Retry with the original command ID.', 409)


@csrf_exempt
def supplier_detail(request, business_id, supplier_id):
    if request.method not in ('GET', 'PATCH'):
        return error('method_not_allowed', 'Use GET or PATCH.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    supplier = Contact.objects.select_related('payable_account').filter(business=member.business, pk=supplier_id, is_supplier=True).first()
    if not supplier:
        return error('not_found', 'Supplier not found.', 404)
    try:
        if request.method == 'PATCH':
            update_supplier(supplier, session.user, body(request))
        result = supplier_data(supplier)
        if request.method == 'GET':
            openings = OpeningPayable.objects.filter(business=member.business, supplier=supplier).order_by('created_at')
            result['opening_payables'] = [{'id': str(item.pk), 'amount': str(item.amount),
                'paid': str(item.paid), 'due': str(item.amount - item.paid)} for item in openings]
        return JsonResponse({'supplier': result})
    except (ValueError, ValidationError) as exc:
        return invalid(exc)


@csrf_exempt
def supplier_image(request, business_id, supplier_id):
    if request.method not in ('POST', 'DELETE'):
        return error('method_not_allowed', 'Use POST or DELETE.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    supplier = Contact.objects.filter(business=member.business, pk=supplier_id, is_supplier=True).first()
    if not supplier:
        return error('not_found', 'Supplier not found.', 404)
    key = None
    if request.method == 'POST':
        upload = request.FILES.get('image')
        if not upload or upload.size > 5 * 1024 * 1024:
            return error('invalid_image', 'Choose an image smaller than 5 MB.')
        try:
            image = Image.open(upload)
            image.verify()
            upload.seek(0)
            image = Image.open(upload)
            if image.format not in ('JPEG', 'PNG', 'WEBP') or image.width * image.height > 25_000_000:
                return error('invalid_image', 'Choose a JPG, PNG or WebP image.')
            image.thumbnail((800, 800))
            if image.mode not in ('RGB', 'RGBA'):
                image = image.convert('RGB')
            output = BytesIO()
            image.save(output, format='WEBP', quality=82)
        except (UnidentifiedImageError, OSError, ValueError):
            return error('invalid_image', 'The selected file is not a valid image.')
        key = default_storage.save(
            f'suppliers/{business_id}/{supplier_id}/{uuid.uuid4().hex}.webp', ContentFile(output.getvalue()))
    try:
        with transaction.atomic():
            if key:
                from media_library.services import register_image
                register_image(business_id, key, upload.name, len(output.getvalue()), session.user)
            supplier = Contact.objects.select_for_update().get(pk=supplier.pk)
            old = supplier.image_key
            if key or old:
                supplier.image_key = key or ''
                supplier.save(update_fields=['image_key', 'updated_at'])
                record(business_id=business_id, actor=session.user, entity_type='supplier',
                       entity_id=supplier.pk, subject=supplier.name,
                       action='image_replaced' if old and key else 'image_added' if key else 'image_removed',
                       changes={'image': {'before': bool(old), 'after': bool(key)}})
                if old:
                    from media_library.services import delete_if_untracked
                    transaction.on_commit(lambda old=old: delete_if_untracked(old))
    except Exception:
        if key:
            default_storage.delete(key)
        raise
    return JsonResponse({'supplier': supplier_data(supplier)})


@csrf_exempt
def supplier_operations(request, business_id, supplier_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    supplier = Contact.objects.filter(business=member.business, pk=supplier_id, is_supplier=True).first()
    if not supplier:
        return error('not_found', 'Supplier not found.', 404)
    try:
        if request.method == 'GET':
            rows = JournalLine.objects.filter(entry__business=member.business, contact=supplier,
                account__code__in=['AP', 'SUPPLIER_ADVANCE']).select_related('entry', 'account').order_by('-entry__created_at', '-pk')
            items, next_page = page(rows, page_number(request))
            return JsonResponse({'activity': [{'id': item.pk, 'entry_id': str(item.entry_id),
                'account': item.account.code, 'description': item.entry.description,
                'debit': str(item.debit), 'credit': str(item.credit),
                'created_at': item.entry.created_at.isoformat()} for item in items],
                'next_page': next_page, 'position': contact_position(supplier)})
        data = body(request)
        kind = data.get('kind')
        purchase = Purchase.objects.filter(business=member.business, supplier=supplier, pk=data.get('purchase_id')).first() if data.get('purchase_id') else None
        opening = OpeningPayable.objects.filter(business=member.business, supplier=supplier, pk=data.get('opening_id')).first() if data.get('opening_id') else None
        if data.get('purchase_id') and not purchase or data.get('opening_id') and not opening:
            raise PurchaseError('Selected payable is unavailable.')
        account = MoneyAccount.objects.filter(business=member.business, pk=data.get('account_id')).first() if data.get('account_id') else None
        operation = supplier_operation(member.business, supplier, session.user,
            command_uuid(request.headers.get('X-Command-ID')), kind, data.get('amount'),
            purchase=purchase, opening=opening, account=account)
        return JsonResponse({'operation': {'id': str(operation.pk), 'kind': operation.kind,
            'amount': str(operation.amount)}, 'position': contact_position(supplier)}, status=201)
    except (ValueError, StockError, AccountingError, ValidationError) as exc:
        return invalid(exc)
    except IntegrityError:
        return error('conflict', 'Supplier action conflicted. Retry with the original command ID.', 409)


@csrf_exempt
def purchases(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    try:
        if request.method == 'GET':
            rows = Purchase.objects.filter(business=member.business).select_related('supplier', 'location').order_by('-created_at', '-id')
            if request.GET.get('supplier_id'):
                rows = rows.filter(supplier_id=request.GET['supplier_id'])
            items, next_page = page(rows, page_number(request))
            return JsonResponse({'purchases': [purchase_data(item) for item in items], 'next_page': next_page})
        purchase = save_draft(member.business, session.user,
            command_uuid(request.headers.get('X-Command-ID')), body(request))
        return JsonResponse({'purchase': purchase_data(purchase, True)}, status=201)
    except (ValueError, StockError, AccountingError, ValidationError) as exc:
        return invalid(exc)
    except IntegrityError:
        return error('conflict', 'Purchase command conflicted. Retry with the original command ID.', 409)


@csrf_exempt
def purchase_detail(request, business_id, purchase_id):
    if request.method not in ('GET', 'PATCH'):
        return error('method_not_allowed', 'Use GET or PATCH.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    purchase = Purchase.objects.filter(business=member.business, pk=purchase_id).select_related('supplier', 'location').first()
    if not purchase:
        return error('not_found', 'Purchase not found.', 404)
    try:
        if request.method == 'PATCH':
            purchase = save_draft(member.business, session.user,
                command_uuid(request.headers.get('X-Command-ID')), body(request), purchase)
        result = purchase_data(purchase, True)
        from .batch_actions import record_notes
        result['added_notes'] = record_notes(member.business, 'purchase', purchase.pk)
        return JsonResponse({'purchase': result})
    except (ValueError, StockError, AccountingError, ValidationError) as exc:
        return invalid(exc)


@csrf_exempt
def purchase_complete(request, business_id, purchase_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    purchase = Purchase.objects.filter(business=member.business, pk=purchase_id).first()
    if not purchase:
        return error('not_found', 'Purchase not found.', 404)
    try:
        data = body(request)
        account = MoneyAccount.objects.filter(business=member.business, pk=data.get('account_id'), is_active=True).first() if data.get('account_id') else None
        purchase = complete_purchase(purchase, session.user,
            command_uuid(request.headers.get('X-Command-ID')), data.get('paid', '0'), account,
            parse_date(data.get('due_date')) if data.get('due_date') else None)
        return JsonResponse({'purchase': purchase_data(purchase, True)})
    except (ValueError, StockError, AccountingError, ValidationError) as exc:
        return invalid(exc)
    except IntegrityError:
        return error('conflict', 'Purchase completion conflicted. Retry with the original command ID.', 409)


@csrf_exempt
def purchase_cancel(request, business_id, purchase_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    purchase = Purchase.objects.filter(business=member.business, pk=purchase_id).first()
    if not purchase:
        return error('not_found', 'Purchase not found.', 404)
    try:
        purchase = cancel_purchase(purchase, session.user,
            command_uuid(request.headers.get('X-Command-ID')), body(request).get('reason'))
        return JsonResponse({'purchase': purchase_data(purchase, True)})
    except (ValueError, StockError, AccountingError, ValidationError) as exc:
        return invalid(exc)
    except IntegrityError:
        return error('conflict', 'Cancellation command conflicted. Retry with the original command ID.', 409)
