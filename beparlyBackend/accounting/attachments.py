import hashlib
import uuid
from io import BytesIO

from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage, storages
from django.db import IntegrityError, transaction
from django.http import FileResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from accounts.models import Business, BusinessMember
from accounts.views import current_member, current_session, error
from purchases.models import Purchase

from .models import MoneyTransaction, RecordAttachment
from .services import AccountingError, command_uuid


MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_ATTACHMENTS = 10


def storage():
    if settings.DEBUG:
        return FileSystemStorage(location=getattr(settings, 'ATTACHMENT_ROOT', settings.BASE_DIR / 'private_attachments'))
    return storages['attachments']


def authorized_target(request, business_id, kind, target_id):
    session = current_session(request)
    if not session:
        return None, None, error('unauthorized', 'Please sign in.', 401)
    member = current_member(session, business_id)
    if not member:
        return None, None, error('not_found', 'Record not found.', 404)
    if kind == 'expense':
        if member.role != BusinessMember.OWNER:
            return None, None, error('forbidden', 'Only the owner can manage expenses.', 403)
        target = MoneyTransaction.objects.filter(business_id=business_id, pk=target_id, kind='expense').first()
    elif kind == 'purchase':
        if member.role != BusinessMember.OWNER and not member.can_manage_purchases:
            return None, None, error('forbidden', 'You cannot manage purchases.', 403)
        target = Purchase.objects.filter(business_id=business_id, pk=target_id).first()
    else:
        return None, None, error('not_found', 'Record not found.', 404)
    if not target:
        return None, None, error('not_found', 'Record not found.', 404)
    return target, session, None


def attachment_data(item):
    return {'id': str(item.pk), 'name': item.name, 'content_type': item.content_type,
            'size': item.size, 'created_at': item.created_at.isoformat()}


def validate_file(upload):
    if not upload or not 0 < upload.size <= MAX_FILE_SIZE:
        raise AccountingError('Choose a JPG, PNG, WebP or PDF file smaller than 10 MB.')
    name = str(upload.name or '').replace('\\', '/').split('/')[-1].strip()
    name = ''.join(character for character in name if character.isprintable())[:160]
    if not name:
        raise AccountingError('Choose a file with a name.')
    content = upload.read(MAX_FILE_SIZE + 1)
    if len(content) > MAX_FILE_SIZE or not content:
        raise AccountingError('Choose a file smaller than 10 MB.')
    if content.startswith(b'%PDF-'):
        if b'%%EOF' not in content[-1024:]:
            raise AccountingError('The selected PDF is not valid.')
        return f'{name.rsplit(".", 1)[0][:156]}.pdf', 'application/pdf', 'pdf', content
    try:
        image = Image.open(BytesIO(content))
        image.verify()
        image = Image.open(BytesIO(content))
        if image.format not in ('JPEG', 'PNG', 'WEBP') or image.width * image.height > 25_000_000:
            raise AccountingError('Choose a JPG, PNG or WebP image.')
        mime, extension = {'JPEG': ('image/jpeg', 'jpg'), 'PNG': ('image/png', 'png'),
                           'WEBP': ('image/webp', 'webp')}[image.format]
        return f'{name.rsplit(".", 1)[0][:156]}.{extension}', mime, extension, content
    except (UnidentifiedImageError, OSError, ValueError):
        raise AccountingError('Choose a valid JPG, PNG, WebP or PDF file.') from None


@csrf_exempt
def collection(request, business_id, kind, target_id):
    if request.method not in ('GET', 'POST'):
        return error('method_not_allowed', 'Use GET or POST.', 405)
    target, session, problem = authorized_target(request, business_id, kind, target_id)
    if problem:
        return problem
    field = 'expense' if kind == 'expense' else 'purchase'
    if request.method == 'GET':
        items = RecordAttachment.objects.filter(business_id=business_id, **{field: target}).order_by('created_at', 'id')
        return JsonResponse({'attachments': [attachment_data(item) for item in items]})
    try:
        command_id = command_uuid(request.headers.get('X-Command-ID'))
        name, content_type, extension, content = validate_file(request.FILES.get('file'))
        digest = hashlib.sha256(content).hexdigest()
        with transaction.atomic():
            Business.objects.select_for_update().get(pk=business_id)
            prior = RecordAttachment.objects.filter(business_id=business_id, command_id=command_id).first()
            if prior:
                if (getattr(prior, f'{field}_id'), prior.name, prior.sha256) != (target.pk, name, digest):
                    raise AccountingError('Retry this attachment with its original file and record.')
                return JsonResponse({'attachment': attachment_data(prior)}, status=200)
            if RecordAttachment.objects.filter(business_id=business_id, **{field: target}).count() >= MAX_ATTACHMENTS:
                raise AccountingError('This record already has 10 attachments.')
            key = f'private-records/{business_id}/{kind}/{target.pk}/{uuid.uuid4().hex}.{extension}'
            saved = storage().save(key, ContentFile(content))
            try:
                item = RecordAttachment.objects.create(business_id=business_id, **{field: target},
                    name=name, content_type=content_type, size=len(content), sha256=digest,
                    file_key=saved, command_id=command_id, uploaded_by=session.user)
            except Exception:
                storage().delete(saved)
                raise
        return JsonResponse({'attachment': attachment_data(item)}, status=201)
    except AccountingError as exc:
        return error('invalid_input', str(exc))
    except IntegrityError:
        return error('conflict', 'Attachment command conflicted. Retry with the same command ID.', 409)


def download(request, business_id, kind, target_id, attachment_id):
    if request.method != 'GET':
        return error('method_not_allowed', 'Use GET.', 405)
    target, _, problem = authorized_target(request, business_id, kind, target_id)
    if problem:
        return problem
    field = 'expense' if kind == 'expense' else 'purchase'
    item = RecordAttachment.objects.filter(business_id=business_id, pk=attachment_id, **{field: target}).first()
    if not item:
        return error('not_found', 'Attachment not found.', 404)
    response = FileResponse(storage().open(item.file_key, 'rb'), as_attachment=True,
                            filename=item.name, content_type=item.content_type)
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'private, no-store'
    return response
