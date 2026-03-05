"""Celery tasks for the ERP connector.

Beat schedule (add to settings.py CELERY_BEAT_SCHEDULE):

    'process-inbound-events': {
        'task': 'erp_connector.tasks.process_pending_inbound_events',
        'schedule': 60,  # every 60 seconds
    },
    'send-outbound-deliveries': {
        'task': 'erp_connector.tasks.send_pending_deliveries',
        'schedule': 30,
    },
    'sync-orders-from-eshop': {
        'task': 'erp_connector.tasks.sync_all_integrations',
        'schedule': 300,  # every 5 minutes
    },
"""

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_inbound_event(self, event_id: int):
    """Process a single InboundEvent by its PK."""
    from erp_connector.models import InboundEvent
    from erp_connector.processor import process_event

    try:
        ev = InboundEvent.objects.get(pk=event_id)
    except InboundEvent.DoesNotExist:
        logger.warning("InboundEvent %s not found", event_id)
        return

    success = process_event(ev)
    if not success and self.request.retries < self.max_retries:
        raise self.retry()


@shared_task
def process_pending_inbound_events(batch_size: int = 100):
    """Process all unprocessed InboundEvents (periodic sweep)."""
    from erp_connector.models import InboundEvent
    from erp_connector.processor import process_event

    events = InboundEvent.objects.filter(
        processed=False,
        attempts__lt=5,
    ).order_by('received_at')[:batch_size]

    processed = 0
    failed = 0
    for ev in events:
        if process_event(ev):
            processed += 1
        else:
            failed += 1

    logger.info("process_pending_inbound_events: processed=%d failed=%d", processed, failed)
    return {'processed': processed, 'failed': failed}


@shared_task
def send_pending_deliveries(limit: int = 50):
    """Send all pending outbound Delivery records."""
    from erp_connector.models import Delivery
    from erp_connector.outbound import send_delivery

    deliveries = (
        Delivery.objects
        .select_for_update(skip_locked=True)
        .filter(status=Delivery.STATUS_PENDING, attempts__lt=5)
        .order_by('created_at')[:limit]
    )

    sent = 0
    failed = 0
    from django.db import transaction
    with transaction.atomic():
        for d in deliveries:
            send_delivery(d)
            if d.status == Delivery.STATUS_SENT:
                sent += 1
            else:
                failed += 1

    logger.info("send_pending_deliveries: sent=%d failed=%d", sent, failed)
    return {'sent': sent, 'failed': failed}


@shared_task
def sync_orders_for_integration(integration_id: int):
    """Pull new orders from eshop for a single integration."""
    from erp_connector.models import ERPIntegration
    from erp_connector.sync import pull_orders

    try:
        integration = ERPIntegration.objects.get(pk=integration_id)
    except ERPIntegration.DoesNotExist:
        logger.warning("ERPIntegration %s not found", integration_id)
        return 0

    count = pull_orders(integration)
    return count


@shared_task
def sync_all_integrations():
    """Pull orders from all integrations that have an outbound URL configured."""
    from erp_connector.models import ERPIntegration

    integrations = ERPIntegration.objects.filter(
        outbound_base_url__isnull=False,
    ).exclude(outbound_base_url='')

    total = 0
    for integ in integrations:
        count = pull_orders_for_integration(integ)
        total += count

    logger.info("sync_all_integrations: total_orders=%d", total)
    return total


def pull_orders_for_integration(integration) -> int:
    from erp_connector.sync import pull_orders
    try:
        return pull_orders(integration)
    except Exception as exc:
        logger.error("sync failed for integration %s: %s", integration.pk, exc)
        return 0


@shared_task
def push_inventory_for_integration(integration_id: int):
    """Push inventory snapshot to eshop for a single integration."""
    from erp_connector.models import ERPIntegration
    from erp_connector.sync import push_inventory

    try:
        integration = ERPIntegration.objects.get(pk=integration_id)
    except ERPIntegration.DoesNotExist:
        logger.warning("ERPIntegration %s not found", integration_id)
        return 0

    return push_inventory(integration)
