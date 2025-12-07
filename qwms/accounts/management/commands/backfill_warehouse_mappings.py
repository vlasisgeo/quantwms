from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Legacy backfill removed: `core.WarehouseUser` is no longer used."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='No-op: legacy backfill removed')

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING('The legacy `core.WarehouseUser` model has been removed.'))
        self.stdout.write('No backfill performed. Accounts models (Membership, WarehouseAssignment) are the canonical source of truth.')
