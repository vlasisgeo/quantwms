from django.core.management.base import BaseCommand

from erp_connector.models import ERPIntegration
from erp_connector.sync import pull_orders


class Command(BaseCommand):
    help = 'Pull new/updated orders from eshop API for all (or one) integrations.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--integration-id', type=int, default=None,
            help='Only sync this integration (default: all with outbound_base_url set)',
        )

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

        if not integrations:
            self.stdout.write('No integrations with outbound_base_url configured.')
            return

        total = 0
        for integ in integrations:
            self.stdout.write(f'Syncing integration id={integ.pk} name={integ.name} ...')
            count = pull_orders(integ)
            total += count
            self.stdout.write(self.style.SUCCESS(f'  Ingested {count} orders.'))

        self.stdout.write(self.style.SUCCESS(f'Total orders ingested: {total}'))
