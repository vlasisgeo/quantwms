from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db import transaction

from erp_connector.models import Delivery
from erp_connector.outbound import send_delivery


class Command(BaseCommand):
    help = 'Send pending outbound deliveries to ERP systems (one-off worker)'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=50, help='Max deliveries to process')

    def handle(self, *args, **options):
        limit = options.get('limit') or 50
        # Select pending deliveries ordered by creation time
        qs = Delivery.objects.select_for_update(skip_locked=True).filter(status=Delivery.STATUS_PENDING).order_by('created_at')[:limit]

        sent = 0
        failed = 0
        with transaction.atomic():
            for d in qs:
                try:
                    send_delivery(d)
                    if d.status == Delivery.STATUS_SENT:
                        sent += 1
                    else:
                        failed += 1
                except Exception as exc:
                    d.attempts += 1
                    d.last_error = str(exc)
                    if d.attempts >= 3:
                        d.status = Delivery.STATUS_FAILED
                    d.save()
                    failed += 1

        self.stdout.write(self.style.SUCCESS(f"Processed deliveries: sent={sent} failed={failed}"))
