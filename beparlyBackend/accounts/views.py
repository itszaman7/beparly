import hashlib
import json
from decimal import Decimal
from io import BytesIO
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from django.contrib.auth import authenticate
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db.models import Count
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import AuthSession, Business, BusinessMember, normalize_phone


def error(code, message, status=400):
    return JsonResponse({'error': {'code': code, 'message': message}}, status=status)


def body(request):
    if not request.content_type == 'application/json':
        raise ValueError('Send a JSON request.')
    try:
        value = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Send valid JSON.') from None
    if not isinstance(value, dict):
        raise ValueError('Send a JSON object.')
    return value


def required_text(data, key, label, limit):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValueError(f'{label} is required (up to {limit} characters).')
    return value.strip()


def current_session(request):
    header = request.headers.get('Authorization', '')
    if not header.startswith('Bearer '):
        return None
    token = header[7:]
    if not token or len(token) > 200:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    return (
        AuthSession.objects.select_related('user')
        .filter(token_hash=token_hash, revoked_at__isnull=True, expires_at__gt=timezone.now(), user__is_active=True)
        .first()
    )


def current_member(session, business_id):
    return (
        BusinessMember.objects.select_related('business')
        .filter(user=session.user, business_id=business_id)
        .first()
    )


def account_data(user):
    return {
        'user': {'id': user.id, 'name': user.first_name, 'phone': user.phone},
        'businesses': [
            {'id': member.business_id, 'name': member.business.name, 'phone': member.business.phone,
             'address': member.business.address, 'logo_url': member.business.logo.url if member.business.logo else None,
             'show_currency_symbol': member.business.show_currency_symbol,
             'invoice_footer_text': member.business.invoice_footer_text,
             'timezone': member.business.timezone,
             'role': member.role, 'can_manage_purchases': member.role == BusinessMember.OWNER or member.can_manage_purchases}
            for member in BusinessMember.objects.select_related('business').filter(user=user).order_by('id')
        ],
    }


@csrf_exempt
def login(request):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    try:
        data = body(request)
        phone = normalize_phone(data.get('phone', ''))
        password = required_text(data, 'password', 'Password', 256)
    except (ValidationError, ValueError):
        return error('invalid_credentials', 'Check your phone number and password.', 401)
    # Bound repeated attempts per phone and source address. A shared cache is needed for multi-worker deployment.
    key = 'login:' + hashlib.sha256(f'{phone}:{request.META.get("REMOTE_ADDR", "")}'.encode()).hexdigest()
    if cache.get(key, 0) >= 10:
        return error('too_many_attempts', 'Too many attempts. Try again in 15 minutes.', 429)
    user = authenticate(request, phone=phone, password=password)
    if not user or not user.is_active:
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, timeout=900)
        return error('invalid_credentials', 'Check your phone number and password.', 401)
    cache.delete(key)
    return JsonResponse({'token': AuthSession.issue(user), **account_data(user)})


@csrf_exempt
def logout(request):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    session.revoked_at = timezone.now()
    session.save(update_fields=['revoked_at'])
    return JsonResponse({'ok': True})


def me(request):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    return JsonResponse(account_data(session.user))


@csrf_exempt
def businesses(request):
    if request.method != 'GET':
        return error('registration_disabled', 'Businesses are created by an administrator.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    return JsonResponse(account_data(session.user))


def business_switcher_summary(request):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    from products.models import Product
    from stockkeeper.models import StockLocation

    business_ids = list(BusinessMember.objects.filter(user=session.user).values_list('business_id', flat=True))
    products = dict(Product.objects.filter(business_id__in=business_ids, is_active=True)
                    .values('business_id').annotate(total=Count('id')).values_list('business_id', 'total'))
    locations = dict(StockLocation.objects.filter(business_id__in=business_ids, is_active=True)
                     .values('business_id').annotate(total=Count('id')).values_list('business_id', 'total'))
    return JsonResponse({'businesses': [{'business_id': business_id, 'products': products.get(business_id, 0),
                                         'locations': locations.get(business_id, 0)} for business_id in business_ids]})


def dashboard_activity(request, business_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return error('not_found', 'Business not found.', 404)
    events = []
    if member.role == BusinessMember.OWNER or member.can_post_stock:
        from sales.models import Sale
        sales = (Sale.objects.filter(business=member.business, status='completed')
                 .prefetch_related('returns').order_by('-created_at')[:4])
        for sale in sales:
            returned = sum((row.amount for row in sale.returns.all()), Decimal('0'))
            events.append({'kind': 'sale', 'id': str(sale.pk), 'number': sale.invoice_number,
                           'party_name': sale.customer_name_snapshot or 'Walk-in customer',
                           'amount': str(sale.total - returned), 'created_at': sale.created_at})
    if member.role == BusinessMember.OWNER or member.can_manage_purchases:
        from purchases.models import Purchase
        purchases = (Purchase.objects.filter(business=member.business, status='completed')
                     .order_by('-completed_at', '-pk')[:4])
        for purchase in purchases:
            events.append({'kind': 'purchase', 'id': str(purchase.pk), 'number': purchase.number,
                           'party_name': purchase.supplier_name, 'amount': str(purchase.total),
                           'created_at': purchase.completed_at or purchase.created_at})
    events.sort(key=lambda item: item['created_at'], reverse=True)
    return JsonResponse({'activity': [{**item, 'created_at': item['created_at'].isoformat()}
                                      for item in events[:4]]})


@csrf_exempt
def business_profile(request, business_id):
    if request.method not in ('GET', 'PATCH'):
        return error('method_not_allowed', 'Use GET or PATCH.', 405)
    session = current_session(request)
    member = current_member(session, business_id) if session else None
    if not member:
        return error('not_found', 'Business profile not found.', 404)
    if request.method == 'PATCH':
        if member.role != BusinessMember.OWNER:
            return error('forbidden', 'Only the business owner can edit business settings.', 403)
        try:
            data = body(request)
            from .label_settings import validate_label_settings
            for key, limit in (('phone', 20), ('address', 255), ('invoice_footer_text', 500)):
                if key in data and (not isinstance(data[key], str) or len(data[key].strip()) > limit):
                    raise ValueError(f'{key.title()} is too long.')
            if 'show_currency_symbol' in data and not isinstance(data['show_currency_symbol'], bool):
                raise ValueError('show_currency_symbol must be true or false.')
            if 'label_print_settings' in data:
                member.business.label_print_settings = validate_label_settings(data['label_print_settings'])
            if 'invoice_paper' in data:
                if data['invoice_paper'] not in ('A4', 'A5'):
                    raise ValueError('Choose A4 or A5 invoice paper.')
                member.business.invoice_paper = data['invoice_paper']
            if 'receipt_paper' in data:
                if data['receipt_paper'] not in ('58mm', '80mm'):
                    raise ValueError('Choose 58 or 80 mm receipt paper.')
                member.business.receipt_paper = data['receipt_paper']
            member.business.phone = str(data.get('phone', member.business.phone)).strip()
            member.business.address = str(data.get('address', member.business.address)).strip()
            member.business.show_currency_symbol = data.get('show_currency_symbol', member.business.show_currency_symbol)
            member.business.invoice_footer_text = str(data.get('invoice_footer_text', member.business.invoice_footer_text)).strip()
            member.business.save(update_fields=['phone', 'address', 'show_currency_symbol', 'invoice_footer_text', 'label_print_settings', 'invoice_paper', 'receipt_paper'])
        except ValueError as exc:
            return error('invalid_input', str(exc))
    business = member.business
    from .label_settings import label_settings
    return JsonResponse({'business': {'id': business.id, 'name': business.name, 'phone': business.phone,
        'address': business.address, 'logo_url': business.logo.url if business.logo else None,
        'show_currency_symbol': business.show_currency_symbol, 'invoice_footer_text': business.invoice_footer_text,
        'label_print_settings': label_settings(business),
        'invoice_paper': business.invoice_paper, 'receipt_paper': business.receipt_paper,
        'role': member.role,
        'can_manage_purchases': member.role == BusinessMember.OWNER or member.can_manage_purchases}})


def label_calibration(request, business_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    session = current_session(request)
    member = current_member(session, business_id) if session else None
    if not member:
        return error('not_found', 'Business not found.', 404)
    from django.http import HttpResponse
    from sales.thermal_label import render_label_calibration
    response = HttpResponse(render_label_calibration(member.business), content_type='application/pdf')
    response['Content-Disposition'] = 'inline; filename="label-calibration.pdf"'
    return response


@csrf_exempt
def business_logo(request, business_id):
    if request.method not in ('POST', 'DELETE'):
        return error('method_not_allowed', 'Use POST or DELETE.', 405)
    session = current_session(request)
    member = current_member(session, business_id) if session else None
    if not member:
        return error('not_found', 'Business profile not found.', 404)
    if member.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the business owner can change the logo.', 403)
    business = member.business
    if request.method == 'POST':
        upload = request.FILES.get('image')
        if not upload or upload.size > 5 * 1024 * 1024:
            return error('invalid_image', 'Choose a logo smaller than 5 MB.')
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
            image.save(output, format='PNG')
        except (UnidentifiedImageError, OSError, ValueError):
            return error('invalid_image', 'The selected file is not a valid image.')
        old_logo = business.logo.name if business.logo else None
        business.logo.save(f'{uuid4().hex}.png', ContentFile(output.getvalue()), save=True)
    else:
        old_logo = business.logo.name if business.logo else None
        business.logo = None
        business.save(update_fields=['logo'])
    if old_logo:
        from media_library.services import delete_if_untracked
        delete_if_untracked(old_logo)
    if request.method == 'POST':
        from media_library.services import register_image
        register_image(business_id, business.logo.name, upload.name, len(output.getvalue()), session.user)
    return JsonResponse({'logo_url': business.logo.url if business.logo else None})


@csrf_exempt
def employees(request, business_id):
    if request.method != 'GET':
        return error('registration_disabled', 'Employees are created by an administrator.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return error('not_found', 'Business profile not found.', 404)
    if member.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the business owner can manage employees.', 403)
    members = BusinessMember.objects.select_related('user').filter(
        business=member.business, role=BusinessMember.EMPLOYEE
    ).order_by('user__first_name', 'id')
    return JsonResponse({'employees': [
        {'id': item.user_id, 'name': item.user.first_name, 'phone': item.user.phone,
         'can_manage_locations': item.can_manage_locations, 'can_post_stock': item.can_post_stock,
         'can_manage_purchases': item.can_manage_purchases}
        for item in members
    ]})


@csrf_exempt
def employee_permissions(request, business_id, user_id):
    if request.method != 'PATCH':
        return error('method_not_allowed', 'Use PATCH.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    owner = current_member(session, business_id)
    if not owner:
        return error('not_found', 'Business profile not found.', 404)
    if owner.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the business owner can manage employee permissions.', 403)
    member = BusinessMember.objects.select_related('user').filter(
        business_id=business_id, user_id=user_id, role=BusinessMember.EMPLOYEE
    ).first()
    if not member:
        return error('not_found', 'Employee not found.', 404)
    try:
        data = body(request)
    except ValueError as exc:
        return error('invalid_input', str(exc))
    allowed = {'can_manage_locations', 'can_post_stock', 'can_manage_purchases'}
    if not data or not set(data) <= allowed or any(not isinstance(value, bool) for value in data.values()):
        return error('invalid_input', 'Send can_manage_locations and/or can_post_stock as true or false.')
    for key, value in data.items():
        setattr(member, key, value)
    member.save(update_fields=list(data))
    return JsonResponse({'employee': {'id': member.user_id, 'name': member.user.first_name,
                                      'phone': member.user.phone,
                                      'can_manage_locations': member.can_manage_locations,
                                      'can_post_stock': member.can_post_stock,
                                      'can_manage_purchases': member.can_manage_purchases}})


@csrf_exempt
def inventory_settings(request, business_id):
    if request.method not in ('GET', 'PATCH'):
        return error('method_not_allowed', 'Use GET or PATCH.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return error('not_found', 'Business profile not found.', 404)
    business = member.business
    if request.method == 'PATCH':
        if member.role != BusinessMember.OWNER:
            return error('forbidden', 'Only the owner can change inventory settings.', 403)
        try:
            data = body(request)
        except ValueError as exc:
            return error('invalid_input', str(exc))
        if set(data) != {'expiry_warning_days'} or type(data['expiry_warning_days']) is not int or not 0 <= data['expiry_warning_days'] <= 365:
            return error('invalid_input', 'Choose an expiry warning from 0 to 365 days.')
        business.expiry_warning_days = data['expiry_warning_days']
        business.save(update_fields=['expiry_warning_days'])
    return JsonResponse({'timezone': business.timezone, 'expiry_warning_days': business.expiry_warning_days})
