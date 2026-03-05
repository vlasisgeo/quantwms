"""Django signals for auto-queuing outbound ERP deliveries.

Document.post_save → order.status_changed delivery (only when status changes)
"""

import logging
from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver

from orders.models import Document

logger = logging.getLogger(__name__)


@receiver(pre_save, sender=Document)
def _document_capture_old_status(sender, instance, **kwargs):
    """Stash the current DB status on the instance before the save."""
    if instance.pk:
        try:
            instance._pre_save_status = Document.objects.values_list(
                'status', flat=True
            ).get(pk=instance.pk)
        except Document.DoesNotExist:
            instance._pre_save_status = None
    else:
        instance._pre_save_status = None


@receiver(post_save, sender=Document)
def _document_queue_status_delivery(sender, instance, created, **kwargs):
    """Queue an order.status_changed delivery when the Document status changes."""
    old_status = getattr(instance, '_pre_save_status', None)
    if not created and instance.status == old_status:
        return  # nothing changed — skip

    try:
        _queue_for_company(
            company=instance.owner,
            event_type='order.status_changed',
            payload={
                'event': 'order.status_changed',
                'doc_number': instance.doc_number,
                'erp_doc_number': instance.erp_doc_number,
                'status': instance.status,
                'status_display': instance.get_status_display(),
                'warehouse': instance.warehouse.code if instance.warehouse else None,
                'owner': instance.owner.code if instance.owner else None,
            },
        )
    except Exception as exc:
        # Never break the caller's save
        logger.warning("Failed to queue status delivery for Document %s: %s", instance.pk, exc)


def _queue_for_company(company, event_type: str, payload: dict):
    """Create a Delivery record for every active integration of this company."""
    from erp_connector.models import ERPIntegration, Delivery

    integrations = ERPIntegration.objects.filter(
        company=company,
        outbound_base_url__isnull=False,
    ).exclude(outbound_base_url='')

    for integ in integrations:
        Delivery.objects.create(
            integration=integ,
            event_type=event_type,
            payload=payload,
        )
