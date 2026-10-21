from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from accounts.models import Business
from accounting.services import AccountingError, ensure_inventory_cutoff, setup_business
from stockkeeper.models import CostLayer, StockBalance


class Command(BaseCommand):
    help = 'Inspect or initialize accounting for existing businesses. Use --apply only after rehearsal.'

    def add_arguments(self, parser):
        parser.add_argument('--business-id', type=int)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        businesses = Business.objects.filter(pk=options['business_id']) if options['business_id'] else Business.objects.all()
        for business in businesses:
            quantity = sum(StockBalance.objects.filter(business=business).values_list('quantity', flat=True), Decimal('0'))
            layers = list(CostLayer.objects.filter(business=business, remaining_quantity__gt=0))
            layer_quantity = sum((item.remaining_quantity for item in layers), Decimal('0'))
            value = sum((item.remaining_quantity * item.unit_cost for item in layers), Decimal('0'))
            self.stdout.write(f'{business.pk} {business.name}: stock {quantity}, layers {layer_quantity}, FIFO value {value}')
            if options['apply']:
                try:
                    setup_business(business)
                    cutoff = ensure_inventory_cutoff(business)
                except AccountingError as exc:
                    raise CommandError(f'Business {business.pk}: {exc}') from exc
                self.stdout.write(self.style.SUCCESS(f'Cutoff recorded: {cutoff.value}'))
