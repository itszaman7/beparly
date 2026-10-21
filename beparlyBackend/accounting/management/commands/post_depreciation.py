from datetime import date

from django.core.management.base import BaseCommand

from accounting.models import BusinessAsset
from accounting.services import AccountingError, depreciate, next_month, month_offset
from stockkeeper.services import business_today


class Command(BaseCommand):
    help = 'Post due monthly depreciation idempotently. Run after each month closes.'

    def handle(self, *args, **options):
        count = 0
        for asset in BusinessAsset.objects.filter(sold_on__isnull=True).select_related('business'):
            current = next_month(date(asset.in_service_date.year, asset.in_service_date.month, 1))
            today = business_today(asset.business)
            last = month_offset(current, asset.useful_life_months - 1)
            while current < today.replace(day=1) and current <= last:
                try:
                    depreciate(asset, current)
                except AccountingError as exc:
                    self.stderr.write(f'{asset.pk}: {exc}')
                    break
                count += 1
                current = next_month(current)
        self.stdout.write(f'Checked {count} depreciation periods.')
