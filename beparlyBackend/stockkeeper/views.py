from django.db import IntegrityError, transaction
from django.utils import timezone
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Business, BusinessMember
from accounts.views import body, current_member, current_session, error, required_text
from accounting.services import AccountingError
from audit.services import differences, record, snapshot

from .models import StockLocation
from .models import CostLayer, StockBalance, StockMovement
from .services import StockError, manual_receive, validate_location, post_waste, post_transfer, post_adjustment, fefo_batches, convert_tracking, validate_sale_batch, resolve_variant
from products.models import Product, ProductVariant, StockBatch
from rest_framework import serializers
import uuid
from decimal import Decimal
from datetime import timedelta


LOCATION_FIELDS = ('name', 'type', 'address', 'is_default', 'is_active')


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
    if creating and result.get('type') == StockLocation.SHOP and not result.get('address', '').strip():
        raise ValueError('Add the shop billing address.')
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
            record(business_id=business_id, actor=current_session(request).user,
                   entity_type='location', entity_id=location.pk, subject=location.name, location_id=location.pk,
                   action='created', changes={'after': snapshot(location, LOCATION_FIELDS)})
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
            before = snapshot(location, LOCATION_FIELDS)
            for key, value in fields.items():
                setattr(location, key, value)
            location.save()
            changes = differences(before, snapshot(location, LOCATION_FIELDS))
            if changes:
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='location', entity_id=location.pk, subject=location.name, location_id=location.pk,
                       action='updated', changes=changes)
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
                    previous = StockLocation.objects.select_for_update().filter(business_id=business_id, is_default=True).first()
                    if previous:
                        previous.is_default = False
                        previous.save(update_fields=['is_default', 'updated_at'])
                        record(business_id=business_id, actor=current_session(request).user,
                               entity_type='location', entity_id=previous.pk, subject=previous.name, location_id=previous.pk,
                               action='updated', changes={'is_default': {'before': True, 'after': False}})
                    location.is_default = True
                    location.save(update_fields=['is_default', 'updated_at'])
                    record(business_id=business_id, actor=current_session(request).user,
                           entity_type='location', entity_id=location.pk, subject=location.name, location_id=location.pk,
                           action='updated', changes={'is_default': {'before': False, 'after': True}})
        except IntegrityError:
            return Response({'error': {'code': 'default_location', 'message':
                            'Could not change the default location. Try again.'}}, status=409)
        return Response({'location': serialize(location)})


class ManualReceiptInput(serializers.Serializer):
    product_id = serializers.UUIDField()
    variant_id = serializers.UUIDField(required=False)
    location_id = serializers.IntegerField(required=False)
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3, min_value=Decimal('0.001'))
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=0)
    reason = serializers.CharField(max_length=240, allow_blank=False)
    financial_reason = serializers.ChoiceField(choices=['owner_contribution', 'count_gain'], required=False)
    batch_id = serializers.UUIDField(required=False)
    unit_id = serializers.UUIDField(required=False)


class ManualReceipt(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, business_id):
        member, problem = permission(request, business_id)
        if problem:
            return problem
        if member.role != BusinessMember.OWNER and not member.can_post_stock:
            return error('forbidden', 'You cannot post stock.', 403)
        try:
            command_id = uuid.UUID(request.headers['X-Command-ID'])
        except (KeyError, ValueError):
            return error('invalid_input', 'Send a valid X-Command-ID.')
        serializer = ManualReceiptInput(data=request.data)
        if not serializer.is_valid():
            return JsonResponse({'error': {'code': 'invalid_input', 'message': 'Check stock entry fields.', 'fields': serializer.errors}}, status=400)
        values = serializer.validated_data
        product = Product.objects.filter(business_id=business_id, pk=values['product_id'], is_active=True).first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        try:
            variant = resolve_variant(product, values.get('variant_id'))
            location = validate_location(business_id, values.get('location_id'))
            batch = StockBatch.objects.filter(variant=variant, pk=values['batch_id']).first() if values.get('batch_id') else None
            if values.get('batch_id') and not batch:
                raise StockError('Choose a batch for this variant.')
            result = manual_receive(product, location, values['quantity'], values['unit_cost'],
                                    current_session(request).user, command_id, values['reason'], batch, values.get('unit_id'), variant,
                                    values.get('financial_reason', 'count_gain'))
        except (StockError, AccountingError) as exc:
            return error('invalid_stock', str(exc), 409)
        return JsonResponse(result, status=201)


class LocationInventory(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, location_id):
        _, problem = permission(request, business_id)
        if problem:
            return problem
        if not StockLocation.objects.filter(business_id=business_id, pk=location_id).exists():
            return error('not_found', 'Location not found.', 404)
        balances = StockBalance.objects.filter(business_id=business_id, location_id=location_id).select_related('product', 'variant').order_by('product__name')
        return JsonResponse({'stock': [{'product_id': str(row.product_id), 'name': row.product.name,
                                       'variant_id': str(row.variant_id), 'variant_label': row.variant.label,
                                       'quantity': str(row.quantity), 'unit': row.variant.base_unit,
                                       'batch_id': str(row.batch_id) if row.batch_id else None} for row in balances]})


class LocationOverview(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, location_id):
        _, problem = permission(request, business_id)
        if problem:
            return problem
        location = StockLocation.objects.filter(business_id=business_id, pk=location_id).first()
        if not location:
            return error('not_found', 'Location not found.', 404)
        today = timezone.localdate()
        warning_end = today + timedelta(days=location.business.expiry_warning_days)
        rows = {}
        for balance in StockBalance.objects.filter(business_id=business_id, location=location).select_related('product', 'variant', 'batch'):
            variant = balance.variant
            item = rows.setdefault(variant.pk, {
                'product_id': str(balance.product_id), 'variant_id': str(variant.pk),
                'sku': variant.sku, 'name': balance.product.name if variant.is_default else f'{balance.product.name} — {variant.label}',
                'unit': variant.base_unit, 'selling_price': variant.retail_price,
                'minimum_stock': variant.minimum_stock, 'available': Decimal('0'),
                'physical': Decimal('0'), 'expiring': False,
            })
            item['physical'] += balance.quantity
            expires = balance.batch.expires_on if balance.batch_id else None
            if expires is None or expires >= today:
                item['available'] += balance.quantity
            if expires is not None and today <= expires <= warning_end and balance.quantity > 0:
                item['expiring'] = True
        costs = {}
        for layer in CostLayer.objects.filter(business_id=business_id, location=location, remaining_quantity__gt=0).values('variant_id', 'remaining_quantity', 'unit_cost'):
            costs[layer['variant_id']] = costs.get(layer['variant_id'], Decimal('0')) + layer['remaining_quantity'] * layer['unit_cost']
        inventory = []
        for variant_id, item in sorted(rows.items(), key=lambda pair: (pair[1]['name'].casefold(), pair[1]['sku'])):
            price = item['selling_price']
            inventory.append({
                'product_id': item['product_id'], 'variant_id': item['variant_id'],
                'sku': item['sku'], 'name': item['name'], 'unit': item['unit'],
                'available_quantity': str(item['available']), 'physical_quantity': str(item['physical']),
                'stock_value': str(item['available'] * price) if price is not None else None,
                'purchase_cost': str(costs.get(variant_id, Decimal('0'))),
                'returning_quantity': None, 'shortage_quantity': None,
                'low_stock': item['available'] <= item['minimum_stock'],
                'expiring_soon': item['expiring'],
            })
        return JsonResponse({'summary': {
            'inventory_value': str(sum(costs.values(), Decimal('0'))),
            'sku_count': len(inventory),
            'low_stock_count': sum(row['low_stock'] for row in inventory),
            'expiring_soon_count': sum(row['expiring_soon'] for row in inventory),
        }, 'inventory': inventory})


class LocationMovements(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, location_id):
        _, problem = permission(request, business_id)
        if problem:
            return problem
        if not StockLocation.objects.filter(business_id=business_id, pk=location_id).exists():
            return error('not_found', 'Location not found.', 404)
        page_raw = request.query_params.get('page')
        if page_raw is not None:
            try:
                page = int(page_raw)
            except ValueError:
                return error('invalid_input', 'Choose a valid page.')
            if page < 1 or page > 100000:
                return error('invalid_input', 'Choose a valid page.')
            offset = (page - 1) * 10
            movements = list(StockMovement.objects.filter(business_id=business_id, location_id=location_id)
                             .select_related('product', 'variant').order_by('-created_at', '-id')[offset:offset + 11])
            next_page = page + 1 if len(movements) > 10 else None
            movements = movements[:10]
        else:
            movements = StockMovement.objects.filter(business_id=business_id, location_id=location_id).select_related('product', 'variant').order_by('-created_at', '-id')[:100]
            next_page = None
        return JsonResponse({'movements': [{'id': str(row.id), 'product_id': str(row.product_id), 'variant_id': str(row.variant_id), 'name': row.product.name,
                                           'variant_label': '' if row.variant.is_default else row.variant.label,
                                           'sku': row.variant.sku, 'unit': row.variant.base_unit,
                                           'type': row.type, 'quantity_change': str(row.quantity_change),
                                           'created_at': row.created_at.isoformat()} for row in movements], 'next_page': next_page})


class StockDeductionInput(serializers.Serializer):
    product_id = serializers.UUIDField()
    variant_id = serializers.UUIDField(required=False)
    location_id = serializers.IntegerField()
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3, min_value=Decimal('0.001'))
    batch_id = serializers.UUIDField(required=False)
    unit_id = serializers.UUIDField(required=False)


class WasteInput(StockDeductionInput):
    reason = serializers.ChoiceField(choices=['damaged', 'broken', 'spoiled', 'expired', 'lost', 'other'])


class TransferInput(StockDeductionInput):
    destination_id = serializers.IntegerField()


class AdjustmentInput(StockDeductionInput):
    increase = serializers.BooleanField()
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=0, required=False)
    reason = serializers.CharField(max_length=240)
    financial_reason = serializers.ChoiceField(choices=['owner_contribution', 'count_gain', 'shortage', 'opening_correction'], required=False)
    opening_movement_id = serializers.UUIDField(required=False)


def stock_command_context(request, business_id, serializer_class):
    member, problem = permission(request, business_id)
    if problem:
        return None, None, None, problem
    if member.role != BusinessMember.OWNER and not member.can_post_stock:
        return None, None, None, error('forbidden', 'You cannot post stock.', 403)
    try:
        command_id = uuid.UUID(request.headers['X-Command-ID'])
    except (KeyError, ValueError):
        return None, None, None, error('invalid_input', 'Send a valid X-Command-ID.')
    serializer = serializer_class(data=request.data)
    if not serializer.is_valid():
        return None, None, None, JsonResponse({'error': {'code': 'invalid_input', 'message': 'Check stock fields.', 'fields': serializer.errors}}, status=400)
    product = Product.objects.filter(business_id=business_id, pk=serializer.validated_data['product_id']).first()
    if not product:
        return None, None, None, error('not_found', 'Product not found.', 404)
    try:
        serializer.validated_data['variant'] = resolve_variant(product, serializer.validated_data.get('variant_id'))
    except StockError as exc:
        return None, None, None, error('invalid_variant', str(exc), 409)
    return product, serializer.validated_data, command_id, None


class WasteCommand(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, business_id):
        product, values, command_id, problem = stock_command_context(request, business_id, WasteInput)
        if problem:
            return problem
        try:
            location = validate_location(business_id, values['location_id'])
            batch = StockBatch.objects.filter(variant=values['variant'], pk=values['batch_id']).first() if values.get('batch_id') else None
            if values.get('batch_id') and not batch:
                raise StockError('Choose a batch for this variant.')
            result = post_waste(product, location, values['quantity'], current_session(request).user,
                                command_id, values['reason'], batch, values.get('unit_id'), values['variant'])
        except (StockError, AccountingError) as exc:
            return error('invalid_stock', str(exc), 409)
        return JsonResponse(result, status=201)


class AdjustmentCommand(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, business_id):
        product, values, command_id, problem = stock_command_context(request, business_id, AdjustmentInput)
        if problem:
            return problem
        cause = values.get('financial_reason')
        if cause == 'opening_correction' and current_member(current_session(request), business_id).role != BusinessMember.OWNER:
            return error('forbidden', 'Only the owner can correct opening stock.', 403)
        if cause and ((values['increase'] and cause not in ('owner_contribution', 'count_gain')) or
                      (not values['increase'] and cause not in ('shortage', 'opening_correction'))):
            return error('invalid_input', 'Choose a financial reason that matches this stock change.')
        opening_movement = None
        if cause == 'opening_correction':
            opening_movement = StockMovement.objects.filter(business_id=business_id, pk=values.get('opening_movement_id')).first()
            if not opening_movement:
                return error('invalid_input', 'Choose the original opening stock movement.')
        try:
            location = validate_location(business_id, values['location_id'])
            batch = StockBatch.objects.filter(variant=values['variant'], pk=values['batch_id']).first() if values.get('batch_id') else None
            if values.get('batch_id') and not batch:
                raise StockError('Choose a batch for this variant.')
            result = post_adjustment(product, location, values['quantity'], values['increase'],
                current_session(request).user, command_id, values['reason'], values.get('unit_cost'), batch, values.get('unit_id'), values['variant'], cause, opening_movement)
        except (StockError, AccountingError) as exc:
            return error('invalid_stock', str(exc), 409)
        return JsonResponse(result, status=201)


class TransferCommand(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, business_id):
        product, values, command_id, problem = stock_command_context(request, business_id, TransferInput)
        if problem:
            return problem
        try:
            source = validate_location(business_id, values['location_id'])
            destination = validate_location(business_id, values['destination_id'])
            batch = StockBatch.objects.filter(variant=values['variant'], pk=values['batch_id']).first() if values.get('batch_id') else None
            if values.get('batch_id') and not batch:
                raise StockError('Choose a batch for this variant.')
            result = post_transfer(product, source, destination, values['quantity'], current_session(request).user,
                                   command_id, batch, values.get('unit_id'), values['variant'])
        except StockError as exc:
            return error('invalid_stock', str(exc), 409)
        return JsonResponse(result, status=201)


class FefoRecommendation(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, product_id):
        _, problem = permission(request, business_id)
        if problem:
            return problem
        product = Product.objects.filter(business_id=business_id, pk=product_id).first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        try:
            location = validate_location(business_id, request.query_params.get('location_id'))
            variant = resolve_variant(product, request.query_params.get('variant_id'))
        except StockError as exc:
            return error('invalid_stock', str(exc), 409)
        return JsonResponse({'recommended_batch_ids': [str(value) for value in fefo_batches(product, location, variant)]})


class TrackingConversionInput(serializers.Serializer):
    tracking_mode = serializers.ChoiceField(choices=Product.TRACKING_CHOICES)
    variant_id = serializers.UUIDField(required=False)
    lot_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    expires_on = serializers.DateField(required=False)


class TrackingConversion(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, business_id, product_id):
        member, problem = permission(request, business_id)
        if problem:
            return problem
        if member.role != BusinessMember.OWNER and not member.can_post_stock:
            return error('forbidden', 'You cannot change stock tracking.', 403)
        try:
            command_id = uuid.UUID(request.headers['X-Command-ID'])
        except (KeyError, ValueError):
            return error('invalid_input', 'Send a valid X-Command-ID.')
        product = Product.objects.filter(business_id=business_id, pk=product_id).select_related('business').first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        serializer = TrackingConversionInput(data=request.data)
        if not serializer.is_valid():
            return JsonResponse({'error': {'code': 'invalid_input', 'message': 'Check tracking fields.', 'fields': serializer.errors}}, status=400)
        values = serializer.validated_data
        try:
            variant = resolve_variant(product, values.get('variant_id'))
            result = convert_tracking(product, values['tracking_mode'], current_session(request).user,
                command_id, values.get('lot_code', ''), values.get('expires_on'), variant)
        except StockError as exc:
            return error('invalid_stock', str(exc), 409)
        return JsonResponse(result)


class BatchSelectionInput(serializers.Serializer):
    location_id = serializers.IntegerField()
    variant_id = serializers.UUIDField(required=False)
    batch_id = serializers.UUIDField(required=False)
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3, min_value=Decimal('0.001'))


class BatchSelection(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, business_id, product_id):
        member, problem = permission(request, business_id)
        if problem:
            return problem
        if member.role != BusinessMember.OWNER and not member.can_post_stock:
            return error('forbidden', 'You cannot select stock batches.', 403)
        product = Product.objects.filter(business_id=business_id, pk=product_id).select_related('business').first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        serializer = BatchSelectionInput(data=request.data)
        if not serializer.is_valid():
            return JsonResponse({'error': {'code': 'invalid_input', 'message': 'Check batch selection.', 'fields': serializer.errors}}, status=400)
        values = serializer.validated_data
        try:
            variant = resolve_variant(product, values.get('variant_id'))
            location = validate_location(business_id, values['location_id'])
            batch = StockBatch.objects.filter(variant=variant, pk=values['batch_id']).first() if values.get('batch_id') else None
            if values.get('batch_id') and not batch:
                raise StockError('Choose a batch for this variant.')
            base = validate_sale_batch(product, location, batch, values['quantity'], variant)
        except StockError as exc:
            return error('ineligible_batch', str(exc), 409)
        return JsonResponse({'eligible': True, 'base_quantity': str(base)})
