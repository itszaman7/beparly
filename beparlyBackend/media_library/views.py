import uuid

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from accounts.models import Business, BusinessMember
from accounts.views import body, current_member, current_session, error
from accounting.models import Contact
from audit.services import record
from products.models import Product

from .models import MediaAsset
from .services import asset_data, delete_if_untracked, normalized_image


def access(request, business_id, owner=False):
    session = current_session(request)
    if not session:
        return None, None, error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return None, None, error('not_found', 'Business not found.', 404)
    if owner and member.role != BusinessMember.OWNER:
        return None, None, error('forbidden', 'Only the owner can manage library photos.', 403)
    return member, session, None


@csrf_exempt
def media_collection(request, business_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    member, session, problem = access(request, business_id, owner=request.method == 'POST')
    if problem:
        return problem
    if request.method == 'GET':
        try:
            page = max(1, int(request.GET.get('page', '1')))
        except ValueError:
            return error('invalid_page', 'Choose a valid page.')
        rows = list(MediaAsset.objects.filter(business=member.business).order_by('-created_at', '-id')[(page - 1) * 40:page * 40 + 1])
        return JsonResponse({'images': [asset_data(row) for row in rows[:40]], 'next_page': page + 1 if len(rows) > 40 else None})
    try:
        upload = request.FILES.get('image')
        content = normalized_image(upload)
    except ValueError as exc:
        return error('invalid_image', str(exc))
    key = default_storage.save(f'media/{business_id}/{uuid.uuid4().hex}.webp', ContentFile(content))
    try:
        with transaction.atomic():
            asset = MediaAsset.objects.create(business=member.business, key=key,
                                              name=(upload.name or 'Photo')[:255], size=len(content), uploaded_by=session.user)
            record(business_id=business_id, actor=session.user, entity_type='media', entity_id=asset.pk,
                   subject=asset.name, action='created', changes={'image': {'before': False, 'after': True}})
    except Exception:
        default_storage.delete(key)
        raise
    return JsonResponse({'image': asset_data(asset, True)}, status=201)


@csrf_exempt
def media_detail(request, business_id, asset_id):
    if request.method not in ('GET', 'DELETE'):
        return error('method_not_allowed', 'Use GET or DELETE.', 405)
    _, _, problem = access(request, business_id, owner=request.method == 'DELETE')
    if problem:
        return problem
    asset = MediaAsset.objects.filter(business_id=business_id, pk=asset_id).first()
    if not asset:
        return error('not_found', 'Photo not found.', 404)
    if request.method == 'GET':
        return JsonResponse({'image': asset_data(asset, True)})
    remove_assets(request, business_id, [asset_id])
    return JsonResponse({'deleted': [str(asset_id)]})


@csrf_exempt
def media_delete_many(request, business_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    _, _, problem = access(request, business_id, owner=True)
    if problem:
        return problem
    try:
        ids = body(request).get('ids')
        if not isinstance(ids, list) or not ids or len(ids) > 100:
            raise ValueError()
        ids = list(dict.fromkeys(uuid.UUID(value) for value in ids))
    except (ValueError, TypeError, AttributeError):
        return error('invalid_input', 'Choose 1 to 100 valid photos.')
    found = set(MediaAsset.objects.filter(business_id=business_id, pk__in=ids).values_list('pk', flat=True))
    if len(found) != len(ids):
        return error('not_found', 'One or more photos were not found.', 404)
    remove_assets(request, business_id, ids)
    return JsonResponse({'deleted': [str(item) for item in ids]})


def remove_assets(request, business_id, ids):
    session = current_session(request)
    with transaction.atomic():
        for asset in MediaAsset.objects.select_for_update().filter(business_id=business_id, pk__in=ids):
            for product in Product.objects.select_for_update().filter(business_id=business_id, image_key=asset.key):
                product.image_key = ''
                product.save(update_fields=['image_key', 'updated_at'])
                record(business_id=business_id, actor=session.user, entity_type='product', entity_id=product.pk,
                       product_id=product.pk, subject=product.name, action='image_removed',
                       changes={'image': {'before': True, 'after': False}})
            for supplier in Contact.objects.select_for_update().filter(business_id=business_id, image_key=asset.key):
                supplier.image_key = ''
                supplier.save(update_fields=['image_key', 'updated_at'])
                record(business_id=business_id, actor=session.user, entity_type='supplier', entity_id=supplier.pk,
                       subject=supplier.name, action='image_removed',
                       changes={'image': {'before': True, 'after': False}})
            business = Business.objects.select_for_update().filter(pk=business_id, logo=asset.key).first()
            if business:
                business.logo = None
                business.save(update_fields=['logo'])
            record(business_id=business_id, actor=session.user, entity_type='media', entity_id=asset.pk,
                   subject=asset.name, action='deleted', changes={'image': {'before': True, 'after': False}})
            key = asset.key
            asset.delete()
            transaction.on_commit(lambda key=key: delete_if_untracked(key))


@csrf_exempt
def media_attach(request, business_id, asset_id):
    if request.method != 'POST':
        return error('method_not_allowed', 'Use POST.', 405)
    member, session, problem = access(request, business_id)
    if problem:
        return problem
    asset = MediaAsset.objects.filter(business_id=business_id, pk=asset_id).first()
    if not asset:
        return error('not_found', 'Photo not found.', 404)
    try:
        data = body(request)
    except ValueError as exc:
        return error('invalid_input', str(exc))
    kind = data.get('kind')
    target_id = data.get('target_id')
    if kind not in ('product', 'supplier', 'business_logo') or not isinstance(target_id, (str, int)):
        return error('invalid_input', 'Choose a product, supplier, or business logo.')
    if kind != 'business_logo':
        try:
            target_id = uuid.UUID(str(target_id))
        except ValueError:
            return error('invalid_input', 'Choose a valid record.')
    if kind == 'supplier' and member.role != BusinessMember.OWNER and not member.can_manage_purchases:
        return error('forbidden', 'You cannot edit suppliers.', 403)
    if kind == 'business_logo' and member.role != BusinessMember.OWNER:
        return error('forbidden', 'Only the owner can change the logo.', 403)
    with transaction.atomic():
        if kind == 'product':
            target = Product.objects.select_for_update().filter(business_id=business_id, pk=target_id).first()
        elif kind == 'supplier':
            target = Contact.objects.select_for_update().filter(business_id=business_id, pk=target_id, is_supplier=True).first()
        else:
            target = Business.objects.select_for_update().filter(pk=business_id).first() if str(target_id) == str(business_id) else None
        if not target:
            return error('not_found', 'Record not found.', 404)
        old = target.logo.name if kind == 'business_logo' and target.logo else target.image_key if kind != 'business_logo' else ''
        if kind == 'business_logo':
            target.logo.name = asset.key
            target.save(update_fields=['logo'])
        else:
            target.image_key = asset.key
            target.save(update_fields=['image_key', 'updated_at'])
        if old != asset.key:
            record(business_id=business_id, actor=session.user, entity_type=kind, entity_id=target.pk,
                   product_id=target.pk if kind == 'product' else None,
                   subject=target.name, action='image_replaced' if old else 'image_added',
                   changes={'image': {'before': bool(old), 'after': True}})
            if old:
                transaction.on_commit(lambda old=old: delete_if_untracked(old))
    return JsonResponse({'image': asset_data(asset, True)})
