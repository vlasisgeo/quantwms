from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from erp_connector.models import InboundEvent, ERPIntegration

from inventory.models import Item
from orders.models import Document, DocumentLine
from core.models import Warehouse


class Command(BaseCommand):
    help = 'Process pending inbound ERP events and map them to local models.'

    BATCH_SIZE = 100
    MAX_ATTEMPTS = 5

    def handle(self, *args, **options):
        qs = InboundEvent.objects.filter(processed=False).order_by('received_at')[: self.BATCH_SIZE]
        if not qs:
            self.stdout.write('No pending inbound ERP events')
            return

        for ev in qs:
            self.stdout.write(f'Processing InboundEvent id={ev.pk} type={ev.event_type}')
            try:
                self.process_event(ev)
            except Exception as e:
                ev.attempts += 1
                ev.last_error = str(e)
                ev.save()
                self.stderr.write(f'Error processing event {ev.pk}: {e}')

    def process_event(self, ev: InboundEvent):
        # Basic dispatcher
        et = ev.event_type.lower()
        data = ev.payload or {}

        if et in ('item.created', 'item.updated', 'item.create', 'item.update'):
            self._process_item(ev, data)
        elif et in ('order.created', 'order.updated', 'order.create', 'order.update'):
            self._process_order(ev, data)
        else:
            # Unknown event type - mark processed to avoid retry loops
            ev.processed = True
            ev.save()
            self.stdout.write(f'Ignored unknown event type: {ev.event_type}')

    @transaction.atomic
    def _process_item(self, ev: InboundEvent, data: dict):
        """Create or update an Item. Note: current Item model uses global unique SKU.

        If multiple companies can have the same SKU, the system currently uses a
        single global Item per SKU. Company-specific ownership is tracked on
        Quants/Document.owner rather than Item. If you need per-company Items,
        we should change the Item model to include an owner/company FK.
        """
        sku = data.get('sku')
        if not sku:
            raise ValueError('Missing sku in item payload')

        item_vals = {}
        for fld in ('name', 'description', 'length_mm', 'width_mm', 'height_mm', 'weight_grams'):
            if fld in data:
                item_vals[fld] = data.get(fld)

        # Boolean flags
        for flag in ('fragile', 'hazardous', 'requires_refrigeration', 'active'):
            if flag in data:
                item_vals[flag] = data.get(flag)

        item, created = Item.objects.update_or_create(sku=sku, defaults=item_vals)
        self.stdout.write(f"Item {'created' if created else 'updated'} sku={sku} id={item.pk}")

        ev.processed = True
        ev.last_error = ''
        ev.processed = True
        ev.save()

    @transaction.atomic
    def _process_order(self, ev: InboundEvent, data: dict):
        """Create or update Document (order) and lines.

        Expected payload keys (flexible):
         - erp_doc_number (external id)
         - doc_number (preferred local doc number)
         - warehouse_code
         - lines: [ { sku, qty, price } ]
        """
        integration = ev.integration
        erp_id = data.get('erp_doc_number') or data.get('external_id') or data.get('id')
        doc_number = data.get('doc_number')
        warehouse_code = data.get('warehouse_code') or data.get('warehouse')

        # Find or create warehouse
        if not warehouse_code:
            raise ValueError('Missing warehouse_code in order payload')

        try:
            warehouse = Warehouse.objects.get(code=warehouse_code)
        except Warehouse.DoesNotExist:
            raise ValueError(f'Warehouse with code {warehouse_code} not found')

        # Find existing Document by erp_doc_number if present
        doc = None
        if erp_id:
            doc = Document.objects.filter(erp_doc_number=erp_id).first()

        if not doc and doc_number:
            doc = Document.objects.filter(doc_number=doc_number).first()

        if doc:
            # Update fields
            doc.warehouse = warehouse
            doc.owner = integration.company
            if erp_id:
                doc.erp_doc_number = erp_id
            doc.save()
            self.stdout.write(f'Updated Document id={doc.pk} doc_number={doc.doc_number}')
        else:
            # Create a new doc_number if not provided
            if not doc_number:
                doc_number = f'ERP-{erp_id or timezone.now().strftime("%Y%m%d%H%M%S%f")}'

            doc = Document.objects.create(
                doc_number=doc_number,
                doc_type=Document.DocType.OUTBOUND_ORDER,
                status=Document.Status.PENDING,
                warehouse=warehouse,
                owner=integration.company,
                erp_doc_number=erp_id or '',
            )
            self.stdout.write(f'Created Document id={doc.pk} doc_number={doc.doc_number}')

        # Process lines
        lines = data.get('lines') or data.get('items') or []
        # Simple approach: delete existing lines and recreate (idempotent if erp_id used)
        doc.lines.all().delete()
        for ln in lines:
            sku = ln.get('sku')
            qty = ln.get('qty') or ln.get('quantity') or 0
            price = ln.get('price')

            if not sku:
                raise ValueError('Line missing sku')

            item, _ = Item.objects.get_or_create(sku=sku, defaults={'name': ln.get('name', sku)})

            DocumentLine.objects.create(
                document=doc,
                item=item,
                qty_requested=qty,
                price=price,
            )

        # After creating lines, update status
        doc._update_status()

        ev.processed = True
        ev.last_error = ''
        ev.save()
