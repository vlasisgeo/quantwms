"""Inbound event processor — converts InboundEvents into WMS objects.

Called from:
  - InboundWebhookView (inline, after storing the event)
  - process_inbound_event Celery task
  - process_erp_inbound management command
"""

import logging
from django.db import transaction
from django.utils import timezone

from inventory.models import Item
from orders.models import Document, DocumentLine
from core.models import Warehouse

logger = logging.getLogger(__name__)


def process_event(ev) -> bool:
    """Dispatch and process a single InboundEvent. Returns True on success."""
    et = ev.event_type.lower()
    data = ev.payload or {}

    try:
        if et in (
            'item.created', 'item.updated', 'item.create', 'item.update',
            'product.created', 'product.updated',
        ):
            _process_item(ev, data)
        elif et in ('order.created', 'order.updated', 'order.create', 'order.update'):
            _process_order(ev, data)
        else:
            ev.processed = True
            ev.save()
            logger.info("Ignored unknown event type: %s", ev.event_type)
        return True
    except Exception as exc:
        ev.attempts += 1
        ev.last_error = str(exc)
        ev.save()
        logger.error("Failed to process InboundEvent id=%s type=%s: %s", ev.pk, ev.event_type, exc)
        return False


@transaction.atomic
def _process_item(ev, data: dict):
    sku = data.get('sku')
    if not sku:
        raise ValueError('Missing sku in item payload')

    item_vals = {}
    for fld in ('name', 'description', 'length_mm', 'width_mm', 'height_mm', 'weight_grams'):
        if fld in data:
            item_vals[fld] = data[fld]
    for flag in ('fragile', 'hazardous', 'requires_refrigeration', 'active'):
        if flag in data:
            item_vals[flag] = data[flag]

    item, created = Item.objects.update_or_create(sku=sku, defaults=item_vals)
    logger.info("Item %s sku=%s id=%s", 'created' if created else 'updated', sku, item.pk)

    ev.processed = True
    ev.last_error = ''
    ev.save()


@transaction.atomic
def _process_order(ev, data: dict):
    integration = ev.integration
    erp_id = data.get('erp_doc_number') or data.get('external_id') or str(data.get('id', ''))
    doc_number = data.get('doc_number')
    warehouse_code = data.get('warehouse_code') or data.get('warehouse')

    # Resolve warehouse: payload → integration default → error
    warehouse = None
    if warehouse_code:
        try:
            warehouse = Warehouse.objects.get(code=warehouse_code)
        except Warehouse.DoesNotExist:
            raise ValueError(f'Warehouse with code {warehouse_code!r} not found')
    elif integration.default_warehouse:
        warehouse = integration.default_warehouse
    else:
        raise ValueError('No warehouse_code in payload and no default_warehouse configured')

    # Find existing document
    doc = None
    if erp_id:
        doc = Document.objects.filter(erp_doc_number=erp_id).first()
    if not doc and doc_number:
        doc = Document.objects.filter(doc_number=doc_number).first()

    if doc:
        doc.warehouse = warehouse
        doc.owner = integration.company
        if erp_id:
            doc.erp_doc_number = erp_id
        doc.save()
        logger.info("Updated Document id=%s doc_number=%s", doc.pk, doc.doc_number)
    else:
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
        logger.info("Created Document id=%s doc_number=%s", doc.pk, doc.doc_number)

    # Sync lines: delete old, create new (idempotent when erp_id used)
    doc.lines.all().delete()
    for ln in (data.get('lines') or data.get('items') or []):
        sku = ln.get('sku')
        qty = int(ln.get('qty') or ln.get('quantity') or 0)
        price = ln.get('price')
        if not sku:
            raise ValueError('Line missing sku')
        item, _ = Item.objects.get_or_create(sku=sku, defaults={'name': ln.get('name', sku)})
        DocumentLine.objects.create(document=doc, item=item, qty_requested=qty, price=price)

    doc._update_status()

    ev.processed = True
    ev.last_error = ''
    ev.save()
