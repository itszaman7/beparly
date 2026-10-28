from django.db.models.signals import post_save
from django.dispatch import receiver

from accounts.models import Business
from audit.services import record

from .models import StockLocation


@receiver(post_save, sender=Business)
def create_default_location(sender, instance, created, **kwargs):
    if created:
        location = StockLocation.objects.create(
            business=instance,
            name='Main Shop',
            type=StockLocation.SHOP,
            address=instance.address,
            is_default=True,
        )
        record(business_id=instance.pk, actor=None, entity_type='location',
               entity_id=location.pk, subject=location.name, location_id=location.pk, action='created',
               changes={'after': {'name': location.name, 'type': location.type, 'address': location.address,
                                  'is_default': True, 'is_active': True}})
