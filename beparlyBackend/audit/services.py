from decimal import Decimal
from uuid import UUID

from .models import AuditEvent


def value(value):
    if isinstance(value, (Decimal, UUID)):
        return str(value)
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return value


def snapshot(instance, fields):
    return {field: value(getattr(instance, field)) for field in fields}


def differences(before, after):
    return {field: {'before': before.get(field), 'after': current}
            for field, current in after.items() if before.get(field) != current}


def record(*, business_id, actor, entity_type, entity_id, action, changes, subject='',
           product_id=None, location_id=None, reference_id=None):
    if not changes and action == 'updated':
        return None
    return AuditEvent.objects.create(
        business_id=business_id, actor=actor, entity_type=entity_type,
        entity_id=str(entity_id), subject=subject, product_id=product_id, location_id=location_id,
        action=action, changes=changes, reference_id=reference_id,
    )
