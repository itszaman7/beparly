import uuid

from django.db import models
from django.db.models import Q


class AuditEvent(models.Model):
    """Business-scoped, append-only history for catalog and warehouse commands."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT, related_name='audit_events')
    actor = models.ForeignKey('accounts.User', null=True, on_delete=models.PROTECT)
    entity_type = models.CharField(max_length=32)
    entity_id = models.CharField(max_length=64)
    subject = models.CharField(max_length=180, blank=True)
    product_id = models.UUIDField(null=True, blank=True)
    location_id = models.PositiveBigIntegerField(null=True, blank=True)
    action = models.CharField(max_length=40)
    changes = models.JSONField(default=dict)
    reference_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['business', '-created_at']),
            models.Index(fields=['business', 'product_id', '-created_at']),
            models.Index(fields=['business', 'location_id', '-created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['business', 'entity_type', 'entity_id', 'action', 'reference_id'],
                condition=Q(reference_id__isnull=False), name='unique_audit_command_event',
            ),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError('Audit events are append-only.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Audit events cannot be deleted.')
