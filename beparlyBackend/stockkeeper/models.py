from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower


class StockLocation(models.Model):
    SHOP = 'shop'
    WAREHOUSE = 'warehouse'
    TYPE_CHOICES = [(SHOP, 'Shop'), (WAREHOUSE, 'Warehouse')]

    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT, related_name='stock_locations')
    name = models.CharField(max_length=160)
    type = models.CharField(max_length=12, choices=TYPE_CHOICES, default=SHOP)
    address = models.CharField(max_length=255, blank=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'name', 'id']
        constraints = [
            models.UniqueConstraint(fields=['business'], condition=Q(is_default=True), name='one_default_stock_location'),
            models.UniqueConstraint(Lower('name'), 'business', name='unique_stock_location_name_per_business'),
        ]

    def clean(self):
        if self.is_default and not self.is_active:
            raise ValidationError({'is_active': 'The default location must stay active.'})

    def __str__(self):
        return f'{self.name} ({self.business})'
