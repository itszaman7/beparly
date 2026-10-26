import json

from django.core.management.base import BaseCommand

from accounts.models import Business
from accounting.reconciliation import reconcile_business


class Command(BaseCommand):
    help = 'Read-only financial and inventory reconciliation; JSON output contains record IDs only.'

    def add_arguments(self, parser):
        parser.add_argument('--business-id', type=int)

    def handle(self, *args, **options):
        businesses = Business.objects.order_by('pk')
        if options['business_id'] is not None:
            businesses = businesses.filter(pk=options['business_id'])
        for business in businesses.iterator():
            findings = reconcile_business(business)
            self.stdout.write(json.dumps({'business_id': business.pk,
                'finding_count': len(findings), 'findings': findings}, sort_keys=True))
