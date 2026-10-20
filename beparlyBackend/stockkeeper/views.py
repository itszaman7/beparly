from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Business, BusinessMember
from accounts.views import body, current_member, current_session, error, required_text

from .models import StockLocation


def serialize(location):
    return {
        'id': location.id,
        'business_id': location.business_id,
        'name': location.name,
        'type': location.type,
        'address': location.address,
        'is_default': location.is_default,
        'is_active': location.is_active,
    }


def permission(request, business_id):
    session = current_session(request)
    if not session:
        return None, error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return None, error('not_found', 'Business profile not found.', 404)
    return member, None


def can_manage(member):
    return member.role == BusinessMember.OWNER or member.can_manage_locations


def parse_location_data(data, creating=False):
    allowed = {'name', 'type', 'address', 'is_active'}
    if not set(data) <= allowed or (creating and 'is_active' in data):
        raise ValueError('Send only location name, type and address.')
    result = {}
    if creating or 'name' in data:
        result['name'] = required_text(data, 'name', 'Location name', 160)
    if creating or 'type' in data:
        location_type = data.get('type')
        if location_type not in (StockLocation.SHOP, StockLocation.WAREHOUSE):
            raise ValueError('Choose Shop or Warehouse.')
        result['type'] = location_type
    if 'address' in data:
        address = data['address']
        if not isinstance(address, str) or len(address.strip()) > 255:
            raise ValueError('Address must be up to 255 characters.')
        result['address'] = address.strip()
    if 'is_active' in data:
        if not isinstance(data['is_active'], bool):
            raise ValueError('is_active must be true or false.')
        result['is_active'] = data['is_active']
    return result


@csrf_exempt
def locations(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, problem = permission(request, business_id)
    if problem:
        return problem
    if request.method == 'GET':
        items = StockLocation.objects.filter(business_id=business_id)
        return JsonResponse({
            'locations': [serialize(item) for item in items],
            'can_manage_locations': can_manage(member),
        })
    if not can_manage(member):
        return error('forbidden', 'You do not have permission to manage locations.', 403)
    try:
        fields = parse_location_data(body(request), creating=True)
        with transaction.atomic():
            location = StockLocation.objects.create(business_id=business_id, **fields)
    except ValueError as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('duplicate_location', 'A location with this name already exists.', 409)
    return JsonResponse({'location': serialize(location)}, status=201)


@csrf_exempt
def location_detail(request, business_id, location_id):
    if request.method not in ('GET', 'PATCH'):
        return error('method_not_allowed', 'Use GET or PATCH.', 405)
    member, problem = permission(request, business_id)
    if problem:
        return problem
    location = StockLocation.objects.filter(business_id=business_id, id=location_id).first()
    if not location:
        return error('not_found', 'Location not found.', 404)
    if request.method == 'GET':
        return JsonResponse({'location': serialize(location), 'can_manage_locations': can_manage(member)})
    if not can_manage(member):
        return error('forbidden', 'You do not have permission to manage locations.', 403)
    try:
        fields = parse_location_data(body(request))
        if not fields:
            raise ValueError('Choose at least one field to update.')
        with transaction.atomic():
            Business.objects.select_for_update().get(pk=business_id)
            location = StockLocation.objects.select_for_update().get(pk=location.pk)
            if location.is_default and fields.get('is_active') is False:
                return error('default_location', 'The default location must stay active.', 409)
            for key, value in fields.items():
                setattr(location, key, value)
            location.save()
    except ValueError as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('duplicate_location', 'A location with this name already exists.', 409)
    return JsonResponse({'location': serialize(location)})


class SetDefaultLocation(APIView):
    """A DRF command using the existing bearer sessions and response contract."""

    authentication_classes = []
    permission_classes = []
    renderer_classes = [JSONRenderer]

    def http_method_not_allowed(self, request, *args, **kwargs):
        return Response({'error': {'code': 'method_not_allowed', 'message': 'Use POST.'}}, status=405)

    def post(self, request, business_id, location_id):
        member, problem = permission(request, business_id)
        if problem:
            return problem
        if not can_manage(member):
            return Response({'error': {'code': 'forbidden', 'message':
                            'You do not have permission to manage locations.'}}, status=403)
        try:
            with transaction.atomic():
                Business.objects.select_for_update().get(pk=business_id)
                location = StockLocation.objects.select_for_update().filter(
                    business_id=business_id, pk=location_id,
                ).first()
                if not location:
                    return Response({'error': {'code': 'not_found', 'message': 'Location not found.'}}, status=404)
                if not location.is_active:
                    return Response({'error': {'code': 'inactive_location', 'message':
                                    'Reactivate this location before making it the default.'}}, status=409)
                if not location.is_default:
                    StockLocation.objects.filter(business_id=business_id, is_default=True).update(is_default=False)
                    location.is_default = True
                    location.save(update_fields=['is_default', 'updated_at'])
        except IntegrityError:
            return Response({'error': {'code': 'default_location', 'message':
                            'Could not change the default location. Try again.'}}, status=409)
        return Response({'location': serialize(location)})
