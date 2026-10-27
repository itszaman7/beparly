import uuid
from decimal import Decimal
from io import BytesIO
from datetime import timedelta

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.db.models import Case, DecimalField, Exists, F, IntegerField, OuterRef, Q, Sum, Value, Subquery, ExpressionWrapper, When
from django.db.models.functions import Coalesce
from django.http import JsonResponse, HttpResponse
from PIL import Image, UnidentifiedImageError
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from rest_framework.views import APIView

from accounts.views import current_member, current_session, error
from accounts.models import BusinessMember

from .models import CatalogCommand, Category, Product, ProductAttribute, ProductAttributeValue, ProductVariant, ProductUnit, StockBatch
from .serializers import CategorySerializer, ProductListSerializer, ProductSerializer, ProductVariantSerializer, ProductUnitSerializer, StockBatchSerializer
from .variants import make_attributes, make_variant
from .barcodes import BarcodeConflict, assert_barcode_available, exact_barcode_target, generated_barcode
from stockkeeper.models import StockMovement
from audit.services import differences, record, snapshot


PRODUCT_FIELDS = ('name', 'product_type', 'specifications', 'description', 'sku', 'barcode', 'category_id', 'base_unit',
                  'purchase_price', 'retail_price', 'wholesale_price', 'minimum_stock',
                  'tracking_mode', 'is_active')
CATEGORY_FIELDS = ('name', 'parent_id', 'is_active')
PACKAGE_FIELDS = ('name', 'factor', 'selling_price', 'barcode', 'is_active')
BATCH_FIELDS = ('lot_code', 'manufactured_on', 'expires_on')


def delete_unreferenced_image(key):
    # Issued documents keep an image key snapshot after the product image changes.
    from media_library.models import MediaAsset
    from accounting.models import Contact
    from accounts.models import Business
    from sales.models import QuotationLine, SaleLine
    if (MediaAsset.objects.filter(key=key).exists() or Product.objects.filter(image_key=key).exists() or
            Contact.objects.filter(image_key=key).exists() or Business.objects.filter(logo=key).exists() or
            QuotationLine.objects.filter(image_url_snapshot=key).exists() or
            SaleLine.objects.filter(image_url_snapshot=key).exists()):
        return
    default_storage.delete(key)


class BarcodeLookupView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        code = request.query_params.get('code', '').strip()
        if not code or len(code) > 100:
            return error('invalid_input', 'Scan a valid barcode.')
        try:
            target = exact_barcode_target(business_id, code)
        except BarcodeConflict as exc:
            return error('ambiguous_barcode', str(exc), 409)
        if not target:
            return error('not_found', 'No active product has this barcode.', 404)
        variant, unit = target
        from stockkeeper.models import StockBalance
        available = StockBalance.objects.filter(variant=variant).aggregate(total=Sum('quantity'))['total'] or 0
        return JsonResponse({'target': {
            'product_id': str(variant.product_id), 'variant_id': str(variant.pk),
            'product_type': variant.product.product_type, 'sellable_stock': str(available),
            'product_name': variant.product.name, 'variant_name': variant.label,
            'sku': variant.sku, 'barcode': code,
            'base_unit': variant.base_unit, 'unit_id': str(unit.pk) if unit else None,
            'unit_name': unit.name if unit else variant.base_unit,
            'factor': str(unit.factor) if unit else '1',
            'retail_price': str(unit.selling_price if unit and unit.selling_price is not None else variant.retail_price) if (unit and unit.selling_price is not None or variant.retail_price is not None) else None,
            'wholesale_price': str(unit.selling_price if unit and unit.selling_price is not None else variant.wholesale_price) if (unit and unit.selling_price is not None or variant.wholesale_price is not None) else None,
        }})


class ProductBarcodeLabelView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, business_id, product_id):
        """Assign a missing legacy barcode without changing an existing identity."""
        _, problem = access(request, business_id)
        if problem:
            return problem
        if not isinstance(request.data, dict):
            return error('invalid_input', 'Choose a valid label item.')
        try:
            variant_id = uuid.UUID(str(request.data['variant_id'])) if request.data.get('variant_id') else None
            unit_id = uuid.UUID(str(request.data['unit_id'])) if request.data.get('unit_id') else None
        except (ValueError, TypeError):
            return error('invalid_input', 'Choose a valid variant or package.')
        try:
            with transaction.atomic():
                from accounts.models import Business
                Business.objects.select_for_update().get(pk=business_id)
                product = Product.objects.select_for_update().filter(business_id=business_id, pk=product_id).first()
                if not product:
                    return error('not_found', 'Product not found.', 404)
                variant = product.variants.select_for_update().filter(pk=variant_id, is_default=False).first() if variant_id else product.variants.select_for_update().filter(is_default=True).first()
                if not variant:
                    return error('invalid_input', 'Choose a variant for this label.')
                unit = variant.packages.select_for_update().filter(pk=unit_id, is_active=True).first() if unit_id else None
                if unit_id and not unit:
                    return error('invalid_input', 'Choose a package of this variant.')
                if unit:
                    if not unit.barcode.strip():
                        code = generated_barcode(unit.pk)
                        assert_barcode_available(business_id, code, unit_id=unit.pk)
                        unit.barcode = code
                        unit.save(update_fields=['barcode'])
                        record(business_id=business_id, actor=current_session(request).user,
                               entity_type='package', entity_id=unit.pk, subject=unit.name,
                               product_id=product.pk, action='updated',
                               changes={'barcode': {'before': '', 'after': code}})
                    return JsonResponse({'barcode': unit.barcode})
                if variant.is_default:
                    code = product.barcode.strip() or variant.barcode.strip() or generated_barcode(product.pk)
                    assert_barcode_available(business_id, code, product_id=product.pk, variant_id=variant.pk)
                    if product.barcode != code:
                        before = product.barcode
                        product.barcode = code
                        product.save(update_fields=['barcode', 'updated_at'])
                        record(business_id=business_id, actor=current_session(request).user,
                               entity_type='product', entity_id=product.pk, subject=product.name,
                               product_id=product.pk, action='updated',
                               changes={'barcode': {'before': before, 'after': code}})
                    if variant.barcode != code:
                        variant.barcode = code
                        variant.save(update_fields=['barcode', 'updated_at'])
                    return JsonResponse({'barcode': code})
                if not variant.barcode.strip():
                    code = generated_barcode(variant.pk)
                    assert_barcode_available(business_id, code, variant_id=variant.pk)
                    variant.barcode = code
                    variant.save(update_fields=['barcode', 'updated_at'])
                    record(business_id=business_id, actor=current_session(request).user,
                           entity_type='variant', entity_id=variant.pk, subject=variant.label,
                           product_id=product.pk, action='updated',
                           changes={'barcode': {'before': '', 'after': code}})
                return JsonResponse({'barcode': variant.barcode})
        except BarcodeConflict as exc:
            return error('duplicate_barcode', str(exc), 409)
        except IntegrityError:
            return error('duplicate_barcode', 'Generated barcode already exists.', 409)

    def get(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = Product.objects.filter(business_id=business_id, pk=product_id).first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        variant_id = request.query_params.get('variant_id')
        variant = product.variants.filter(pk=variant_id).first() if variant_id else product.variants.filter(is_default=True).first()
        if not variant:
            return error('invalid_input', 'Choose a variant for this label.')
        unit_id = request.query_params.get('unit_id')
        unit = variant.packages.filter(pk=unit_id, is_active=True).first() if unit_id else None
        if unit_id and not unit:
            return error('invalid_input', 'Choose a package of this variant.')
        paper = request.query_params.get('paper', '50x30')
        try:
            count = int(request.query_params.get('count', '1'))
            from .labels import render_product_labels
            pdf = render_product_labels(product, variant, unit, paper=paper, count=count)
        except (ValueError, ImportError) as exc:
            return error('invalid_input', str(exc))
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="product-{product.pk}-barcode.pdf"'
        return response


class PurchaseCatalogView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        try:
            page = int(request.query_params.get('page', '1'))
            if not 1 <= page <= 100000:
                raise ValueError
        except ValueError:
            return error('invalid_input', 'Choose a valid page.')
        search = request.query_params.get('search', '').strip()[:100]
        from purchases.models import PurchaseLine
        from stockkeeper.models import StockBalance
        prior = PurchaseLine.objects.filter(variant_id=OuterRef('pk'), purchase__status='completed').order_by('-purchase__completed_at', '-pk')
        prior = prior.annotate(base_cost=ExpressionWrapper(F('unit_cost') / F('conversion_factor'), output_field=DecimalField(max_digits=18, decimal_places=4)))
        stock = StockBalance.objects.filter(variant_id=OuterRef('pk')).values('variant_id').annotate(total=Sum('quantity')).values('total')
        rows = ProductVariant.objects.filter(business_id=business_id, is_active=True, product__is_active=True).select_related('product')
        if search:
            package_match = ProductUnit.objects.filter(variant_id=OuterRef('pk'), barcode=search, is_active=True)
            rows = rows.annotate(package_barcode_match=Exists(package_match)).filter(
                               Q(product__name__icontains=search) | Q(label__icontains=search) |
                               Q(sku__icontains=search) | Q(barcode__icontains=search) |
                               Q(product__specifications__icontains=search) | Q(package_barcode_match=True))
        rows = rows.annotate(last_cost=Subquery(prior.values('base_cost')[:1]), stock_quantity=Subquery(stock[:1]))
        if search:
            rows = rows.annotate(exact_match=Case(When(Q(barcode=search) | Q(sku=search) | Q(package_barcode_match=True), then=Value(0)),
                                                 default=Value(1), output_field=IntegerField())).order_by('exact_match', 'product__name', 'label', 'pk')
        else:
            rows = rows.order_by('product__name', 'label', 'pk')
        found = list(rows[(page - 1) * 30:page * 30 + 1])
        return JsonResponse({'items': [{
            'product_id': str(row.product_id), 'variant_id': str(row.pk), 'name': row.product.name,
            'variant_label': row.label, 'sku': row.sku, 'barcode': row.barcode,
            'package_barcode_match': bool(row.package_barcode_match) if search else False,
            'base_unit': row.base_unit, 'tracking_mode': row.tracking_mode,
            'image_url': default_storage.url(row.product.image_key) if row.product.image_key else None,
            'stock': str(row.stock_quantity or 0),
            'last_purchase_cost': str(row.last_cost) if row.last_cost is not None else None,
            'default_purchase_cost': str(row.purchase_price) if row.purchase_price is not None else None,
        } for row in found[:30]], 'next_page': page + 1 if len(found) > 30 else None})


class OpeningSerializer(serializers.Serializer):
    quantity = serializers.DecimalField(max_digits=18, decimal_places=3, min_value=0)
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=0, required=False, default=0)
    location_id = serializers.IntegerField(required=False)
    lot_code = serializers.CharField(max_length=100, required=False)
    expires_on = serializers.DateField(required=False)

    def validate(self, attrs):
        if attrs['quantity'] > 0 and 'unit_cost' not in self.initial_data:
            raise serializers.ValidationError({'unit_cost': 'Enter the actual opening inventory unit cost.'})
        return attrs


def access(request, business_id):
    session = current_session(request)
    if not session:
        return None, error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return None, error('not_found', 'Business profile not found.', 404)
    return member, None


def invalid(serializer):
    return JsonResponse({'error': {'code': 'invalid_input', 'message': 'Check the highlighted fields.',
                                   'fields': serializer.errors}}, status=400)


def descendants(business_id, root_id):
    parents = dict(Category.objects.filter(business_id=business_id).values_list('id', 'parent_id'))
    if root_id not in parents:
        return None
    result = {root_id}
    frontier = {root_id}
    while frontier:
        frontier = {id for id, parent_id in parents.items() if parent_id in frontier and id not in result}
        result.update(frontier)
    return result


def catalog_stock(business_id):
    from accounts.models import Business
    from stockkeeper.services import business_today

    today = business_today(Business.objects.get(pk=business_id))
    quantity_field = DecimalField(max_digits=18, decimal_places=3)
    return Product.objects.filter(business_id=business_id).select_related('business').annotate(
        sellable_sum=Coalesce(
            Sum('balances__quantity', filter=Q(balances__batch__expires_on__isnull=True) |
                Q(balances__batch__expires_on__gte=today)),
            Value(Decimal('0'), output_field=quantity_field), output_field=quantity_field,
        ),
    )


class CatalogSummaryView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        active = catalog_stock(business_id).filter(is_active=True)
        return JsonResponse({'active_products': active.count(),
                             'low_stock': active.filter(minimum_stock__gt=0, sellable_sum__gt=0,
                                                        sellable_sum__lte=F('minimum_stock')).count(),
                             'out_of_stock': active.filter(sellable_sum__lte=0).count()})


class ProductMovementsView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        if not Product.objects.filter(business_id=business_id, pk=product_id).exists():
            return error('not_found', 'Product not found.', 404)
        variant_id = request.query_params.get('variant_id')
        if variant_id and not ProductVariant.objects.filter(business_id=business_id, product_id=product_id, pk=variant_id).exists():
            return error('not_found', 'Variant not found.', 404)
        movements = StockMovement.objects.filter(
            business_id=business_id, product_id=product_id,
        ).select_related('location', 'batch').order_by('-created_at', '-id')
        if variant_id:
            movements = movements.filter(variant_id=variant_id)
        if request.query_params.get('type') == 'opening':
            movements = movements.filter(type='opening')[:100]
        else:
            movements = movements[:20]
        return JsonResponse({'movements': [{
            'id': str(row.id), 'variant_id': str(row.variant_id), 'type': row.type, 'quantity_change': str(row.quantity_change),
            'location': row.location.name, 'location_id': row.location_id,
            'batch': row.batch.lot_code if row.batch_id else None, 'batch_id': str(row.batch_id) if row.batch_id else None,
            'reason': row.reason, 'created_at': row.created_at.isoformat(),
        } for row in movements]})


class CatalogView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        query = catalog_stock(business_id)
        search = request.query_params.get('search', '').strip()[:100]
        if search:
            matches = ProductVariant.objects.filter(product_id=OuterRef('pk')).filter(
                Q(label__icontains=search) | Q(sku__icontains=search) | Q(barcode__icontains=search))
            query = query.annotate(variant_match=Exists(matches)).filter(
                Q(name__icontains=search) | Q(sku__icontains=search) |
                Q(barcode__icontains=search) | Q(variant_match=True))
        active = request.query_params.get('active')
        if active not in (None, '', 'true', 'false'):
            return error('invalid_input', 'Choose a valid status.')
        if active in ('true', 'false'):
            query = query.filter(is_active=(active == 'true'))
        stock = request.query_params.get('stock', 'all')
        if stock == 'in_stock':
            query = query.filter(sellable_sum__gt=0)
        elif stock == 'low_stock':
            query = query.filter(minimum_stock__gt=0, sellable_sum__gt=0,
                                 sellable_sum__lte=F('minimum_stock'))
        elif stock == 'out_of_stock':
            query = query.filter(sellable_sum__lte=0)
        elif stock != 'all':
            return error('invalid_input', 'Choose a valid stock filter.')
        tracking = request.query_params.get('tracking', 'all')
        if tracking not in ('all', 'simple', 'batch', 'expiry'):
            return error('invalid_input', 'Choose a valid tracking mode.')
        if tracking != 'all':
            query = query.filter(tracking_mode=tracking)
        category = request.query_params.get('category')
        if category:
            try:
                ids = descendants(business_id, uuid.UUID(category))
            except ValueError:
                return error('invalid_input', 'Choose a valid category.')
            if ids is None:
                return error('not_found', 'Category not found.', 404)
            query = query.filter(category_id__in=ids)
        try:
            page = max(1, int(request.query_params.get('page', '1')))
        except ValueError:
            return error('invalid_input', 'Choose a valid page.')
        if page > 100000:
            return error('invalid_input', 'Choose a valid page.')
        ordering = {
            'name': ('name', 'id'), 'name_desc': ('-name', 'id'),
            'newest': ('-created_at', 'id'),
            'price_asc': (F('retail_price').asc(nulls_last=True), 'id'),
            'price_desc': (F('retail_price').desc(nulls_last=True), 'id'),
            'stock_asc': ('sellable_sum', 'id'), 'stock_desc': ('-sellable_sum', 'id'),
        }
        sort = request.query_params.get('sort', 'name')
        if sort not in ordering:
            return error('invalid_input', 'Choose a valid sort order.')
        query = query.order_by(*ordering[sort])
        rows = list(query[(page - 1) * 30:page * 30 + 1].prefetch_related('variants', 'balances__variant', 'balances__batch'))
        return JsonResponse({'products': ProductListSerializer(rows[:30], many=True).data,
                             'next_page': page + 1 if len(rows) > 30 else None})

    def post(self, request, business_id):
        member, problem = access(request, business_id)
        if problem:
            return problem
        try:
            command_id = uuid.UUID(request.headers['X-Command-ID'])
        except (KeyError, ValueError):
            return error('invalid_input', 'Send a valid X-Command-ID.')
        payload = request.data.copy()
        opening = payload.pop('opening_stock', None)
        attribute_data = payload.pop('attributes', None)
        variant_data = payload.pop('variants', None)
        is_variant = payload.get('product_type') == 'variant'
        if is_variant and (opening is not None or not isinstance(variant_data, list) or not variant_data):
            return error('invalid_input', 'Define variants and their opening stock separately.')
        if not is_variant and (attribute_data is not None or variant_data is not None):
            return error('invalid_input', 'Choose variant product type to define attributes.')
        opening_serializer = OpeningSerializer(data=opening) if opening is not None else None
        if opening_serializer and not opening_serializer.is_valid():
            return invalid(opening_serializer)
        if opening_serializer and opening_serializer.validated_data['quantity'] > 0 and member.role != BusinessMember.OWNER and not member.can_post_stock:
            return error('forbidden', 'You cannot post opening stock.', 403)
        serializer = ProductSerializer(data=payload, context={'business_id': business_id})
        if not serializer.is_valid():
            return invalid(serializer)
        try:
            with transaction.atomic():
                from accounts.models import Business
                Business.objects.select_for_update().get(pk=business_id)
                prior = CatalogCommand.objects.filter(business_id=business_id, command_id=command_id).select_related('product').first()
                if prior:
                    return JsonResponse({'product': ProductSerializer(prior.product).data})
                product = serializer.save()
                if is_variant:
                    attributes = make_attributes(product, attribute_data)
                    for attribute, choices in attributes.values():
                        record(business_id=business_id, actor=current_session(request).user,
                               entity_type='attribute', entity_id=attribute.pk, subject=attribute.name,
                               product_id=product.pk, action='created', reference_id=command_id,
                               changes={'values': [choice.value for choice in choices.values()]})
                    seen = set()
                    for item in variant_data:
                        variant = make_variant(product, item, attributes)
                        record(business_id=business_id, actor=current_session(request).user,
                               entity_type='variant', entity_id=variant.pk, subject=variant.label,
                               product_id=product.pk, action='created', reference_id=command_id,
                               changes={'after': ProductVariantSerializer(variant).data})
                        if variant.combination_key in seen:
                            raise serializers.ValidationError({'variants': 'Duplicate variant combination.'})
                        seen.add(variant.combination_key)
                        stock = item.get('opening_stock')
                        if stock:
                            opening_input = OpeningSerializer(data=stock)
                            opening_input.is_valid(raise_exception=True)
                            if opening_input.validated_data['quantity'] > 0:
                                if member.role != BusinessMember.OWNER and not member.can_post_stock:
                                    raise serializers.ValidationError({'opening_stock': 'You cannot post opening stock.'})
                                from stockkeeper.services import receive, validate_location
                                values = opening_input.validated_data
                                location = validate_location(business_id, values.get('location_id'))
                                batch = None
                                if variant.tracking_mode != Product.SIMPLE:
                                    lot = values.get('lot_code', '').strip()
                                    if not lot or variant.tracking_mode == Product.EXPIRY and not values.get('expires_on'):
                                        raise serializers.ValidationError({'opening_stock': 'A batch and expiry date are required.'})
                                    batch = StockBatch.objects.create(product=product, variant=variant, lot_code=lot, expires_on=values.get('expires_on'))
                                receive(product, location, values['quantity'], values['unit_cost'], current_session(request).user, command_id,
                                        batch=batch, variant=variant)
                    prices = [variant.retail_price for variant in product.variants.filter(is_active=True) if variant.retail_price is not None]
                    product.retail_price = min(prices) if prices else None
                    product.save(update_fields=['retail_price', 'updated_at'])
                else:
                    default_variant = product.variants.get(is_default=True)
                assert_barcode_available(business_id, product.barcode, product_id=product.pk)
                for created_variant in product.variants.filter(is_default=False):
                    assert_barcode_available(business_id, created_variant.barcode, variant_id=created_variant.pk)
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='product', entity_id=product.pk, subject=product.name, product_id=product.pk,
                       action='created', changes={'after': snapshot(product, PRODUCT_FIELDS)},
                       reference_id=command_id)
                if opening_serializer and opening_serializer.validated_data['quantity'] > 0:
                    from stockkeeper.services import receive, validate_location
                    values = opening_serializer.validated_data
                    location = validate_location(business_id, values.get('location_id'))
                    batch = None
                    if product.tracking_mode != Product.SIMPLE:
                        lot = values.get('lot_code', '').strip()
                        if not lot or product.tracking_mode == Product.EXPIRY and not values.get('expires_on'):
                            raise ValueError('Opening stock needs a batch identifier and an expiry date when expiry tracking is enabled.')
                        batch = StockBatch.objects.create(product=product, variant=default_variant, lot_code=lot, expires_on=values.get('expires_on'))
                    receive(product, location, values['quantity'], values['unit_cost'], current_session(request).user, command_id, batch=batch, variant=default_variant)
                CatalogCommand.objects.create(business_id=business_id, command_id=command_id, product=product)
        except serializers.ValidationError as exc:
            return JsonResponse({'error': {'code': 'invalid_input', 'message': 'Check variant fields.', 'fields': exc.detail}}, status=400)
        except BarcodeConflict as exc:
            return error('duplicate_barcode', str(exc), 409)
        except ValueError as exc:
            return error('invalid_stock', str(exc))
        except IntegrityError:
            prior = CatalogCommand.objects.filter(business_id=business_id, command_id=command_id).select_related('product').first()
            if prior:
                return JsonResponse({'product': ProductSerializer(prior.product).data})
            return error('duplicate_product', 'SKU or barcode already exists in this business.', 409)
        return JsonResponse({'product': ProductSerializer(product).data}, status=201)


class ProductDetailView(APIView):
    authentication_classes = []
    permission_classes = []

    def get_product(self, business_id, product_id):
        return Product.objects.filter(business_id=business_id, pk=product_id).first()

    def get(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = self.get_product(business_id, product_id)
        if not product:
            return error('not_found', 'Product not found.', 404)
        from stockkeeper.services import stock_summary
        result = {'product': ProductSerializer(product).data, 'stock': stock_summary(product)}
        if product.product_type == 'variant':
            result['variants'] = ProductVariantSerializer(product.variants.filter(is_default=False), many=True).data
        return JsonResponse(result)

    def patch(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        try:
            command_id = uuid.UUID(request.headers['X-Command-ID']) if 'X-Command-ID' in request.headers else None
        except ValueError:
            return error('invalid_input', 'Send a valid X-Command-ID.')
        product = self.get_product(business_id, product_id)
        if not product:
            return error('not_found', 'Product not found.', 404)
        try:
            with transaction.atomic():
                from accounts.models import Business
                Business.objects.select_for_update().get(pk=business_id)
                if command_id:
                    prior = CatalogCommand.objects.filter(business_id=business_id, command_id=command_id).first()
                    if prior:
                        if prior.product_id != product.pk:
                            return error('duplicate_command', 'This command ID was already used.', 409)
                        product.refresh_from_db()
                        return JsonResponse({'product': ProductSerializer(product).data})
                product = Product.objects.select_for_update().get(pk=product.pk)
                serializer = ProductSerializer(product, data=request.data, partial=True, context={'business_id': business_id})
                if not serializer.is_valid():
                    return invalid(serializer)
                before = snapshot(product, PRODUCT_FIELDS)
                product = serializer.save()
                assert_barcode_available(business_id, product.barcode, product_id=product.pk)
                if product.product_type == 'simple':
                    ProductVariant.objects.filter(product=product, is_default=True).update(**{
                        field: getattr(product, field) for field in ('sku', 'barcode', 'base_unit', 'purchase_price',
                            'retail_price', 'wholesale_price', 'minimum_stock', 'tracking_mode', 'is_active')})
                changes = differences(before, snapshot(product, PRODUCT_FIELDS))
                action = ('deactivated' if product.is_active is False else 'activated') if 'is_active' in changes else 'updated'
                if changes:
                    record(business_id=business_id, actor=current_session(request).user,
                           entity_type='product', entity_id=product.pk, subject=product.name, product_id=product.pk,
                           action=action, changes=changes, reference_id=command_id)
                if command_id:
                    CatalogCommand.objects.create(business_id=business_id, command_id=command_id, product=product)
        except BarcodeConflict as exc:
            return error('duplicate_barcode', str(exc), 409)
        except IntegrityError:
            return error('duplicate_product', 'SKU or barcode already exists in this business.', 409)
        return JsonResponse({'product': ProductSerializer(product).data})


class CategoryView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        categories = Category.objects.filter(business_id=business_id).order_by('name', 'id')
        return JsonResponse({'categories': CategorySerializer(categories, many=True).data})

    def post(self, request, business_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        serializer = CategorySerializer(data=request.data, context={'business_id': business_id})
        if not serializer.is_valid():
            return invalid(serializer)
        try:
            with transaction.atomic():
                category = serializer.save(business_id=business_id)
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='category', entity_id=category.pk, subject=category.name, action='created',
                       changes={'after': snapshot(category, CATEGORY_FIELDS)})
        except IntegrityError:
            return error('duplicate_category', 'A category with this name already exists under this parent.', 409)
        return JsonResponse({'category': CategorySerializer(category).data}, status=201)


class CategoryDetailView(APIView):
    authentication_classes = []
    permission_classes = []

    def patch(self, request, business_id, category_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        category = Category.objects.filter(business_id=business_id, pk=category_id).first()
        if not category:
            return error('not_found', 'Category not found.', 404)
        try:
            with transaction.atomic():
                from accounts.models import Business
                Business.objects.select_for_update().get(pk=business_id)
                category = Category.objects.select_for_update().get(pk=category.pk)
                serializer = CategorySerializer(category, data=request.data, partial=True, context={'business_id': business_id})
                if not serializer.is_valid():
                    return invalid(serializer)
                before = snapshot(category, CATEGORY_FIELDS)
                category = serializer.save()
                changes = differences(before, snapshot(category, CATEGORY_FIELDS))
                if changes:
                    record(business_id=business_id, actor=current_session(request).user,
                           entity_type='category', entity_id=category.pk, subject=category.name, action='updated', changes=changes)
        except IntegrityError:
            return error('duplicate_category', 'A category with this name already exists under this parent.', 409)
        return JsonResponse({'category': CategorySerializer(category).data})


class ProductImageView(APIView):
    authentication_classes = []
    permission_classes = []
    parser_classes = [MultiPartParser]

    def post(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = Product.objects.filter(business_id=business_id, pk=product_id).first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        command_id = request.headers.get('X-Command-ID')
        if command_id:
            try:
                command_id = uuid.UUID(command_id)
            except ValueError:
                return error('invalid_command', 'Use a valid photo command ID.')
            from media_library.models import MediaAsset
            if MediaAsset.objects.filter(business_id=business_id, upload_command_id=command_id).exists():
                return JsonResponse({'product': ProductSerializer(product).data})
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
        key = f'products/{business_id}/{product_id}/{uuid.uuid4().hex}.webp'
        key = default_storage.save(key, ContentFile(output.getvalue()))
        try:
            with transaction.atomic():
                from media_library.services import register_image
                register_image(business_id, key, upload.name, len(output.getvalue()), current_session(request).user, command_id)
                product = Product.objects.select_for_update().get(pk=product.pk)
                old = product.image_key
                product.image_key = key
                product.save(update_fields=['image_key', 'updated_at'])
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='product', entity_id=product.pk, subject=product.name, product_id=product.pk,
                       action='image_replaced' if old else 'image_added',
                       changes={'image': {'before': bool(old), 'after': True}})
                if old:
                    transaction.on_commit(lambda: delete_unreferenced_image(old))
        except Exception:
            default_storage.delete(key)
            raise
        return JsonResponse({'product': ProductSerializer(product).data})

    def delete(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = Product.objects.filter(business_id=business_id, pk=product_id).first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        with transaction.atomic():
            product = Product.objects.select_for_update().get(pk=product.pk)
            old = product.image_key
            if old:
                product.image_key = ''
                product.save(update_fields=['image_key', 'updated_at'])
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='product', entity_id=product.pk, subject=product.name, product_id=product.pk,
                       action='image_removed', changes={'image': {'before': True, 'after': False}})
                transaction.on_commit(lambda: delete_unreferenced_image(old))
        return JsonResponse({'product': ProductSerializer(product).data})


class ProductUnitsView(APIView):
    authentication_classes = []
    permission_classes = []

    def product(self, business_id, product_id):
        return Product.objects.filter(business_id=business_id, pk=product_id).first()

    def get(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = self.product(business_id, product_id)
        if not product:
            return error('not_found', 'Product not found.', 404)
        from stockkeeper.services import resolve_variant, StockError
        try:
            variant = resolve_variant(product, request.query_params.get('variant_id'))
        except StockError as exc:
            return error('invalid_variant', str(exc), 409)
        return JsonResponse({'base_unit': variant.base_unit, 'variant_id': str(variant.pk), 'units': ProductUnitSerializer(variant.packages.order_by('name'), many=True).data})

    def post(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = self.product(business_id, product_id)
        if not product:
            return error('not_found', 'Product not found.', 404)
        serializer = ProductUnitSerializer(data=request.data)
        if not serializer.is_valid():
            return invalid(serializer)
        from stockkeeper.services import resolve_variant, StockError
        try:
            variant = resolve_variant(product, request.data.get('variant_id'))
        except StockError as exc:
            return error('invalid_variant', str(exc), 409)
        try:
            with transaction.atomic():
                from accounts.models import Business
                Business.objects.select_for_update().get(pk=business_id)
                unit = serializer.save(product=product, variant=variant)
                assert_barcode_available(business_id, unit.barcode, unit_id=unit.pk)
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='package', entity_id=unit.pk, subject=unit.name, product_id=product.pk,
                       action='created', changes={'after': snapshot(unit, PACKAGE_FIELDS)})
        except BarcodeConflict as exc:
            return error('duplicate_barcode', str(exc), 409)
        except IntegrityError:
            return error('duplicate_unit', 'This package name already exists.', 409)
        return JsonResponse({'unit': ProductUnitSerializer(unit).data}, status=201)


class ProductUnitDetailView(APIView):
    authentication_classes = []
    permission_classes = []

    def patch(self, request, business_id, product_id, unit_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        unit = ProductUnit.objects.filter(product__business_id=business_id, product_id=product_id, pk=unit_id).first()
        if not unit:
            return error('not_found', 'Packaging unit not found.', 404)
        serializer = ProductUnitSerializer(unit, data=request.data, partial=True)
        if not serializer.is_valid():
            return invalid(serializer)
        try:
            with transaction.atomic():
                from accounts.models import Business
                Business.objects.select_for_update().get(pk=business_id)
                before = snapshot(unit, PACKAGE_FIELDS)
                unit = serializer.save()
                assert_barcode_available(business_id, unit.barcode, unit_id=unit.pk)
                changes = differences(before, snapshot(unit, PACKAGE_FIELDS))
                if changes:
                    record(business_id=business_id, actor=current_session(request).user,
                           entity_type='package', entity_id=unit.pk, subject=unit.name, product_id=product_id,
                           action='updated', changes=changes)
        except BarcodeConflict as exc:
            return error('duplicate_barcode', str(exc), 409)
        except IntegrityError:
            return error('duplicate_unit', 'This package name already exists.', 409)
        return JsonResponse({'unit': serializer.data})


class ProductBatchesView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = Product.objects.filter(business_id=business_id, pk=product_id).select_related('business').first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        from stockkeeper.services import resolve_variant, StockError
        try:
            variant = resolve_variant(product, request.query_params.get('variant_id'))
        except StockError as exc:
            return error('invalid_variant', str(exc), 409)
        from stockkeeper.services import business_today
        today = business_today(product.business)
        records = []
        for batch in StockBatch.objects.filter(variant=variant).prefetch_related('stockbalance_set__location'):
            status = ('expired' if batch.expires_on and batch.expires_on < today else
                      'expiring_soon' if batch.expires_on and batch.expires_on <= today + timedelta(days=product.business.expiry_warning_days) else 'ok')
            for row in list(batch.stockbalance_set.all()) or [None]:
                physical = row.quantity if row else 0
                records.append({'id': str(batch.pk), 'lot_code': batch.lot_code,
                    'expires_on': batch.expires_on.isoformat() if batch.expires_on else None,
                    'location_id': row.location_id if row else None, 'location': row.location.name if row else '',
                    'physical': str(physical), 'sellable': str(physical if status != 'expired' else 0),
                    'status': status})
        return JsonResponse({'batches': records})

    def post(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = Product.objects.filter(business_id=business_id, pk=product_id).first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        from stockkeeper.services import resolve_variant, StockError
        try:
            variant = resolve_variant(product, request.data.get('variant_id'))
        except StockError as exc:
            return error('invalid_variant', str(exc), 409)
        if variant.tracking_mode == Product.SIMPLE:
            return error('invalid_batch', 'Enable batch tracking first.', 409)
        serializer = StockBatchSerializer(data=request.data)
        if not serializer.is_valid():
            return invalid(serializer)
        if variant.tracking_mode == Product.EXPIRY and not serializer.validated_data.get('expires_on'):
            return error('invalid_batch', 'Expiry date is required for this product.')
        try:
            with transaction.atomic():
                batch = serializer.save(product=product, variant=variant)
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='batch', entity_id=batch.pk, subject=batch.lot_code, product_id=product.pk,
                       action='created', changes={'after': snapshot(batch, BATCH_FIELDS)})
        except IntegrityError:
            return error('duplicate_batch', 'This lot and expiry date already exist.', 409)
        return JsonResponse({'batch': StockBatchSerializer(batch).data}, status=201)


class ProductAttributesView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        if not Product.objects.filter(business_id=business_id, pk=product_id).exists():
            return error('not_found', 'Product not found.', 404)
        attributes = ProductAttribute.objects.filter(product_id=product_id).prefetch_related('values')
        return JsonResponse({'attributes': [{'id': str(item.pk), 'name': item.name,
            'values': [{'id': str(value.pk), 'value': value.value} for value in item.values.all()]}
            for item in attributes]})

    def post(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = Product.objects.filter(business_id=business_id, pk=product_id, product_type='variant').first()
        if not product:
            return error('not_found', 'Variant product not found.', 404)
        if product.variants.exists():
            return error('variant_history', 'Attribute dimensions cannot change after variants are created.', 409)
        try:
            with transaction.atomic():
                created = make_attributes(product, [request.data])
                attribute = next(iter(created.values()))[0]
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='attribute', entity_id=attribute.pk, subject=attribute.name,
                       product_id=product.pk, action='created',
                       changes={'values': list(request.data.get('values', []))})
        except serializers.ValidationError as exc:
            return JsonResponse({'error': {'code': 'invalid_input', 'message': 'Check attribute fields.', 'fields': exc.detail}}, status=400)
        except IntegrityError:
            return error('duplicate_attribute', 'Attribute already exists.', 409)
        return JsonResponse({'attribute': {'id': str(attribute.pk), 'name': attribute.name}}, status=201)


class ProductAttributeDetailView(APIView):
    authentication_classes = []
    permission_classes = []

    def patch(self, request, business_id, product_id, attribute_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        attribute = ProductAttribute.objects.filter(product__business_id=business_id, product_id=product_id, pk=attribute_id).first()
        if not attribute:
            return error('not_found', 'Attribute not found.', 404)
        if set(request.data) != {'add_value'} or not isinstance(request.data['add_value'], str) or not request.data['add_value'].strip():
            return error('invalid_input', 'Send one new allowed value.')
        try:
            with transaction.atomic():
                value = ProductAttributeValue.objects.create(attribute=attribute, value=request.data['add_value'].strip())
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='attribute_value', entity_id=value.pk, subject=value.value,
                       product_id=product_id, action='created', changes={'attribute': attribute.name})
        except IntegrityError:
            return error('duplicate_value', 'Allowed value already exists.', 409)
        return JsonResponse({'value': {'id': str(value.pk), 'value': value.value}})


class ProductVariantsView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        product = Product.objects.filter(business_id=business_id, pk=product_id).first()
        if not product:
            return error('not_found', 'Product not found.', 404)
        return JsonResponse({'variants': ProductVariantSerializer(
            product.variants.filter(is_default=False).order_by('label'), many=True).data})

    def post(self, request, business_id, product_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        try:
            command_id = uuid.UUID(request.headers['X-Command-ID'])
        except (KeyError, ValueError):
            return error('invalid_input', 'Send a valid X-Command-ID.')
        try:
            with transaction.atomic():
                from accounts.models import Business
                Business.objects.select_for_update().get(pk=business_id)
                product = Product.objects.select_for_update().filter(business_id=business_id, pk=product_id, product_type='variant').first()
                if not product:
                    return error('not_found', 'Variant product not found.', 404)
                prior = CatalogCommand.objects.filter(business_id=business_id, command_id=command_id).first()
                if prior:
                    variant = product.variants.filter(id=request.data.get('id')).first()
                    if variant:
                        return JsonResponse({'variant': ProductVariantSerializer(variant).data})
                    return error('duplicate_command', 'This command ID was already used.', 409)
                attributes = {item.name.casefold(): (item, {value.value.casefold(): value for value in item.values.all()})
                              for item in product.attributes.prefetch_related('values')}
                variant = make_variant(product, request.data, attributes)
                assert_barcode_available(business_id, variant.barcode, variant_id=variant.pk)
                CatalogCommand.objects.create(business_id=business_id, command_id=command_id, product=product)
                record(business_id=business_id, actor=current_session(request).user,
                       entity_type='variant', entity_id=variant.pk, subject=variant.label, product_id=product.pk,
                       action='created', reference_id=command_id,
                       changes={'after': ProductVariantSerializer(variant).data})
                prices = list(product.variants.filter(is_active=True, retail_price__isnull=False).values_list('retail_price', flat=True))
                product.retail_price = min(prices) if prices else None
                product.save(update_fields=['retail_price', 'updated_at'])
        except serializers.ValidationError as exc:
            return JsonResponse({'error': {'code': 'invalid_input', 'message': 'Check variant fields.', 'fields': exc.detail}}, status=400)
        except BarcodeConflict as exc:
            return error('duplicate_barcode', str(exc), 409)
        except IntegrityError:
            return error('duplicate_variant', 'SKU, barcode or combination already exists.', 409)
        return JsonResponse({'variant': ProductVariantSerializer(variant).data}, status=201)


class ProductVariantDetailView(APIView):
    authentication_classes = []
    permission_classes = []

    def get_variant(self, business_id, product_id, variant_id):
        return ProductVariant.objects.filter(business_id=business_id, product_id=product_id,
                                             pk=variant_id, is_default=False).select_related('product').first()

    def get(self, request, business_id, product_id, variant_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        variant = self.get_variant(business_id, product_id, variant_id)
        if not variant:
            return error('not_found', 'Variant not found.', 404)
        from stockkeeper.services import stock_summary
        return JsonResponse({'variant': ProductVariantSerializer(variant).data,
                             'product_id': str(product_id), 'stock': stock_summary(variant.product, variant)})

    def patch(self, request, business_id, product_id, variant_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        variant = self.get_variant(business_id, product_id, variant_id)
        if not variant:
            return error('not_found', 'Variant not found.', 404)
        if 'selections' in request.data or 'id' in request.data:
            return error('invalid_input', 'Variant identity and selected attributes cannot be changed.')
        serializer = ProductVariantSerializer(variant, data=request.data, partial=True)
        if not serializer.is_valid():
            return invalid(serializer)
        from stockkeeper.models import StockBalance
        if 'base_unit' in request.data and StockMovement.objects.filter(variant=variant).exists():
            return error('invalid_unit', 'Historical stock uses this base unit.', 409)
        if 'tracking_mode' in request.data and request.data['tracking_mode'] != variant.tracking_mode and StockMovement.objects.filter(variant=variant).exists():
            return error('invalid_tracking', 'Use the audited tracking conversion workflow for stock with history.', 409)
        if request.data.get('is_active') is False and StockBalance.objects.filter(variant=variant, quantity__gt=0).exists():
            return error('stock_remains', 'Clear variant stock before deactivation.', 409)
        try:
            with transaction.atomic():
                from accounts.models import Business
                Business.objects.select_for_update().get(pk=business_id)
                before = ProductVariantSerializer(variant).data
                variant = serializer.save()
                assert_barcode_available(business_id, variant.barcode, variant_id=variant.pk)
                changes = differences(before, ProductVariantSerializer(variant).data)
                if changes:
                    record(business_id=business_id, actor=current_session(request).user,
                           entity_type='variant', entity_id=variant.pk, subject=variant.label,
                           product_id=product_id, action='updated', changes=changes)
                prices = list(variant.product.variants.filter(is_active=True, retail_price__isnull=False).values_list('retail_price', flat=True))
                variant.product.retail_price = min(prices) if prices else None
                variant.product.save(update_fields=['retail_price', 'updated_at'])
        except BarcodeConflict as exc:
            return error('duplicate_barcode', str(exc), 409)
        except IntegrityError:
            return error('duplicate_variant', 'SKU or barcode already exists.', 409)
        return JsonResponse({'variant': ProductVariantSerializer(variant).data})


class VariantBatchesView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, product_id, variant_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        variant = ProductVariant.objects.filter(business_id=business_id, product_id=product_id, pk=variant_id, is_default=False).first()
        if not variant:
            return error('not_found', 'Variant not found.', 404)
        return JsonResponse({'batches': StockBatchSerializer(variant.batches.order_by('created_at'), many=True).data})


class VariantMovementsView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id, product_id, variant_id):
        _, problem = access(request, business_id)
        if problem:
            return problem
        if not ProductVariant.objects.filter(business_id=business_id, product_id=product_id, pk=variant_id, is_default=False).exists():
            return error('not_found', 'Variant not found.', 404)
        movements = StockMovement.objects.filter(business_id=business_id, product_id=product_id,
            variant_id=variant_id).select_related('location', 'batch').order_by('-created_at', '-id')[:50]
        return JsonResponse({'movements': [{'id': str(row.pk), 'product_id': str(product_id),
            'variant_id': str(variant_id), 'type': row.type, 'quantity_change': str(row.quantity_change),
            'location': row.location.name, 'batch': row.batch.lot_code if row.batch_id else None,
            'reason': row.reason, 'created_at': row.created_at.isoformat()} for row in movements]})

