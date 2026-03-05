"""Pull/push sync helpers.

pull_orders(integration)  — fetch new/updated orders from eshop REST API
push_inventory(integration) — push current inventory snapshot to eshop
"""

import logging
import requests
from django.utils import timezone

logger = logging.getLogger(__name__)


def _auth_headers(integration) -> dict:
    headers = {'Content-Type': 'application/json'}
    if integration.outbound_auth_token:
        headers['Authorization'] = f'Bearer {integration.outbound_auth_token}'
    return headers


def pull_orders(integration) -> int:
    """Poll the eshop for orders updated since ``integration.last_synced_at``.

    The eshop must expose:
        GET {outbound_base_url}/orders/?updated_since=<ISO8601>

    Response must be a JSON list OR a dict with an ``orders``/``results``/``data`` key.
    Each order is stored as an InboundEvent and immediately processed.

    Returns the number of orders ingested.
    """
    from .models import InboundEvent
    from .processor import process_event

    if not integration.outbound_base_url:
        logger.warning("Integration %s has no outbound_base_url — skipping pull", integration.pk)
        return 0

    since = integration.last_synced_at or integration.created_at
    url = integration.outbound_base_url.rstrip('/') + '/orders/'
    params = {'updated_since': since.isoformat()}

    try:
        resp = requests.get(url, params=params, headers=_auth_headers(integration), timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.error("pull_orders failed for integration %s: %s", integration.pk, exc)
        return 0

    body = resp.json()
    if isinstance(body, dict):
        orders = body.get('orders') or body.get('results') or body.get('data') or []
    else:
        orders = body or []

    count = 0
    for order_data in orders:
        external_id = str(order_data.get('id') or order_data.get('erp_doc_number') or '')

        # Idempotency: skip if we already have this event
        if external_id and InboundEvent.objects.filter(
            integration=integration,
            event_id=external_id,
            event_type='order.created',
        ).exists():
            continue

        ev = InboundEvent.objects.create(
            integration=integration,
            event_id=external_id or None,
            event_type='order.created',
            payload=order_data,
        )
        process_event(ev)
        count += 1

    integration.last_synced_at = timezone.now()
    integration.save(update_fields=['last_synced_at'])
    logger.info("pull_orders integration=%s ingested=%d", integration.pk, count)
    return count


def push_inventory(integration) -> int:
    """Push a full inventory snapshot for the integration's company to the eshop.

    The eshop must expose:
        POST {outbound_base_url}/inventory/

    Payload:
        {
            "event": "inventory.snapshot",
            "company": "<code>",
            "items": [
                {"sku": "SKU-001", "qty": 100, "qty_reserved": 10, "qty_available": 90,
                 "warehouse": "WH1", "bin": "A-01-01", "lot_code": null}
            ]
        }

    Returns number of quant records included in the snapshot.
    """
    from .models import Delivery
    from inventory.models import Quant

    if not integration.outbound_base_url:
        logger.warning("Integration %s has no outbound_base_url — skipping push", integration.pk)
        return 0

    quants = Quant.objects.filter(owner=integration.company).select_related(
        'item', 'bin', 'bin__warehouse', 'lot'
    )

    items_payload = [
        {
            'sku': q.item.sku,
            'qty': q.qty,
            'qty_reserved': q.qty_reserved,
            'qty_available': q.qty_available,
            'warehouse': q.bin.warehouse.code if q.bin and q.bin.warehouse else None,
            'bin': q.bin.location_code if q.bin else None,
            'lot_code': q.lot.lot_code if q.lot else None,
        }
        for q in quants
    ]

    payload = {
        'event': 'inventory.snapshot',
        'company': integration.company.code,
        'snapshot_at': timezone.now().isoformat(),
        'items': items_payload,
    }

    # Store as a Delivery so it goes through the standard send queue
    Delivery.objects.create(
        integration=integration,
        event_type='inventory.snapshot',
        payload=payload,
    )
    logger.info("push_inventory queued snapshot for integration=%s items=%d", integration.pk, len(items_payload))
    return len(items_payload)
