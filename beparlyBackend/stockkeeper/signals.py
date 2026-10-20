from django.db.models.signals import post_save
from django.dispatch import receiver

from accounts.models import Business

from .models import StockLocation


@receiver(post_save, sender=Business)
def create_default_location(sender, instance, created, **kwargs):
    if created:
        StockLocation.objects.create(
            business=instance,
            name='Main Shop',
            type=StockLocation.SHOP,
            is_default=True,
        )
