import hashlib
import json
from uuid import uuid4

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import AuthSession, Business, BusinessMember, User, normalize_phone


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


def optional_username(data):
    value = data.get('username', '')
    if not isinstance(value, str) or len(value.strip()) > 150:
        raise ValueError('Username must be up to 150 characters.')
    return value.strip()


def valid_password(password, user):
    if not isinstance(password, str):
        raise ValueError('Password is required.')
    try:
        validate_password(password, user)
    except ValidationError as exc:
        raise ValueError(' '.join(exc.messages)) from None


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
            {'id': member.business_id, 'name': member.business.name, 'role': member.role}
            for member in BusinessMember.objects.select_related('business').filter(user=user).order_by('id')
        ],
    }


@csrf_exempt
def register(request):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    try:
        data = body(request)
        username = optional_username(data)
        phone = normalize_phone(data.get('phone', ''))
        user = User(phone=phone, first_name=username)
        valid_password(data.get('password'), user)
        with transaction.atomic():
            user.set_password(data['password'])
            user.save()
            token = AuthSession.issue(user)
    except ValidationError as exc:
        return error('invalid_phone', ' '.join(exc.messages))
    except ValueError as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('phone_in_use', 'An account with this phone number already exists.', 409)
    return JsonResponse({'token': token, **account_data(user)}, status=201)


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
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    if request.method == 'GET':
        return JsonResponse(account_data(session.user))
    try:
        data = body(request)
        name = required_text(data, 'name', 'Business name', 160)
        with transaction.atomic():
            business = Business.objects.create(name=name)
            BusinessMember.objects.create(user=session.user, business=business, role=BusinessMember.OWNER)
            from accounting.models import MoneyAccount
            from accounting.services import amount, money_operation, setup_business
            setup_business(business)
            opening_cash = data.get('opening_cash', '')
            if opening_cash not in ('', None):
                cash = MoneyAccount.objects.get(business=business, is_default=True)
                money_operation(business, session.user, uuid4(), 'opening_balance',
                                amount(opening_cash), cash, allow_opening=True)
    except ValueError as exc:
        return error('invalid_input', str(exc))
    return JsonResponse({'business': {'id': business.id, 'name': business.name, 'role': BusinessMember.OWNER}}, status=201)


@csrf_exempt
def employees(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    session = current_session(request)
    if not session:
        return error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return error('not_found', 'Business profile not found.', 404)
    if member.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the business owner can manage employees.', 403)
    if request.method == 'GET':
        members = BusinessMember.objects.select_related('user').filter(
            business=member.business, role=BusinessMember.EMPLOYEE
        ).order_by('user__first_name', 'id')
        return JsonResponse({'employees': [
            {'id': item.user_id, 'name': item.user.first_name, 'phone': item.user.phone,
             'can_manage_locations': item.can_manage_locations, 'can_post_stock': item.can_post_stock}
            for item in members
        ]})
    try:
        data = body(request)
        username = optional_username(data)
        phone = normalize_phone(data.get('phone', ''))
        user = User(phone=phone, first_name=username)
        valid_password(data.get('password'), user)
        with transaction.atomic():
            user.set_password(data['password'])
            user.save()
            BusinessMember.objects.create(user=user, business=member.business, role=BusinessMember.EMPLOYEE)
    except ValidationError as exc:
        return error('invalid_phone', ' '.join(exc.messages))
    except ValueError as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('phone_in_use', 'An account with this phone number already exists.', 409)
    return JsonResponse({'employee': {'id': user.id, 'name': user.first_name, 'phone': user.phone,
                                      'can_manage_locations': True, 'can_post_stock': True}}, status=201)


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
    allowed = {'can_manage_locations', 'can_post_stock'}
    if not data or not set(data) <= allowed or any(not isinstance(value, bool) for value in data.values()):
        return error('invalid_input', 'Send can_manage_locations and/or can_post_stock as true or false.')
    for key, value in data.items():
        setattr(member, key, value)
    member.save(update_fields=list(data))
    return JsonResponse({'employee': {'id': member.user_id, 'name': member.user.first_name,
                                      'phone': member.user.phone,
                                      'can_manage_locations': member.can_manage_locations,
                                      'can_post_stock': member.can_post_stock}})


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
