from django.core.management.base import BaseCommand

from erp_connector.models import InboundEvent
from erp_connector.processor import process_event


class Command(BaseCommand):
    help = 'Process pending inbound ERP events (batch worker — use Celery in production).'

    def add_arguments(self, parser):
        parser.add_argument('--batch-size', type=int, default=100)
        parser.add_argument('--max-attempts', type=int, default=5)

    def handle(self, *args, **options):
        batch_size = options['batch_size']
        max_attempts = options['max_attempts']

        qs = InboundEvent.objects.filter(
            processed=False, attempts__lt=max_attempts
        ).order_by('received_at')[:batch_size]

        if not qs:
            self.stdout.write('No pending inbound ERP events.')
            return

        ok = failed = 0
        for ev in qs:
            self.stdout.write(f'Processing InboundEvent id={ev.pk} type={ev.event_type}')
            if process_event(ev):
                ok += 1
            else:
                failed += 1
                self.stderr.write(f'  Failed: {ev.last_error}')

        self.stdout.write(self.style.SUCCESS(f'Done: processed={ok} failed={failed}'))
