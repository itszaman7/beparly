import uuid

from django.conf import settings
from django.db import models


class MediaAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT, related_name='media_assets')
    key = models.CharField(max_length=500, unique=True)
    name = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField(default=0)
    upload_command_id = models.UUIDField(null=True, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [models.UniqueConstraint(fields=['business', 'upload_command_id'], name='unique_media_upload_command')]

