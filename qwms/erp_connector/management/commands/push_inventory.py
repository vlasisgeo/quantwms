from django.core.management.base import BaseCommand

from erp_connector.models import ERPIntegration
from erp_connector.sync import push_inventory


class Command(BaseCommand):
    help = 'Queue an inventory snapshot delivery for all (or one) integrations.'

    def add_arguments(self, parser):
        parser.add_argument('--integration-id', type=int, default=None)

    def handle(self, *args, **options):
        integration_id = options.get('integration_id')

        if integration_id:
            try:
                integrations = [ERPIntegration.objects.get(pk=integration_id)]
            except ERPIntegration.DoesNotExist:
                self.stderr.write(f'ERPIntegration id={integration_id} not found.')
                return
        else:
            integrations = list(
                ERPIntegration.objects.filter(
                    outbound_base_url__isnull=False,
                ).exclude(outbound_base_url='')
            )

        for integ in integrations:
            count = push_inventory(integ)
            self.stdout.write(
                self.style.SUCCESS(
                    f'Integration id={integ.pk}: queued snapshot ({count} quants)'
                )
            )

        self.stdout.write('Run send_outbound to deliver the queued snapshots.')
