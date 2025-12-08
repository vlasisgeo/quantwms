from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db import transaction
from datetime import timedelta

from erp_connector.models import Delivery, ERPIntegration
from orders.models import Document


class Command(BaseCommand):
    help = 'Queue outbound deliveries for recently completed orders.'

    def add_arguments(self, parser):
        parser.add_argument('--since-minutes', type=int, default=60, help='Lookback window in minutes')
        parser.add_argument('--limit', type=int, default=100, help='Max deliveries to create per integration')

    def handle(self, *args, **options):
        since_minutes = options.get('since_minutes', 60)
        limit = options.get('limit', 100)

        cutoff = timezone.now() - timedelta(minutes=since_minutes)

        total_created = 0

        integrations = ERPIntegration.objects.filter(outbound_base_url__isnull=False).exclude(outbound_base_url='')
        for integ in integrations:
            docs = Document.objects.filter(
                owner=integ.company,
                status=Document.Status.COMPLETED,
                updated_at__gte=cutoff,
            ).order_by('updated_at')[:limit]

            created = 0
            with transaction.atomic():
                for d in docs:
                    # avoid duplicates: check existing Delivery for this doc_number
                    exists = Delivery.objects.filter(integration=integ, event_type='order.fulfilled', payload__doc_number=d.doc_number).exists()
                    if exists:
                        continue

                    payload = {
                        'event': 'order.fulfilled',
                        'doc_number': d.doc_number,
                        'erp_doc_number': d.erp_doc_number,
                        'warehouse': d.warehouse.code if d.warehouse else None,
                        'owner_company': d.owner.code if d.owner else None,
                        'completed_at': d.updated_at.isoformat(),
                        'lines': [
                            {
                                'sku': line.item.sku,
                                'qty': line.qty_requested,
                                'qty_picked': line.qty_picked,
                                'price': str(line.price) if line.price is not None else None,
                            }
                            for line in d.lines.all()
                        ],
                    }

                    Delivery.objects.create(
                        integration=integ,
                        event_type='order.fulfilled',
                        payload=payload,
                    )
                    created += 1
                    total_created += 1

            self.stdout.write(self.style.SUCCESS(f"Integration {integ.id}: queued {created} deliveries"))

        self.stdout.write(self.style.SUCCESS(f"Total deliveries queued: {total_created}"))
