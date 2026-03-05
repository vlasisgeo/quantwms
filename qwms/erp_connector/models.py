from django.db import models
from django.utils import timezone

from core.models import Company, Warehouse


class ERPIntegration(models.Model):
    """Per-company ERP integration configuration."""

    name = models.CharField(max_length=200)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='erp_integrations')
    description = models.TextField(blank=True)

    # Secret used by ERP to sign inbound webhook payloads (HMAC-SHA256)
    inbound_secret = models.CharField(max_length=200, blank=True)

    # Outbound: base URL + bearer token for calling back the eshop
    outbound_base_url = models.URLField(blank=True)
    outbound_auth_token = models.CharField(max_length=200, blank=True)

    # Pull sync: default warehouse for orders fetched from eshop
    default_warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='erp_integrations',
        help_text='Used when a pulled order does not specify a warehouse',
    )
    # Timestamp of last successful pull sync (used as ?updated_since= param)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'ERP Integration'
        verbose_name_plural = 'ERP Integrations'

    def __str__(self) -> str:  # pragma: no cover
        return f"ERPIntegration({self.name}@{self.company})"


class InboundEvent(models.Model):
    """Represents an inbound webhook event from an ERP system."""

    integration = models.ForeignKey(ERPIntegration, on_delete=models.CASCADE, related_name='inbound_events')
    event_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    event_type = models.CharField(max_length=100, db_index=True)
    payload = models.JSONField()
    received_at = models.DateTimeField(default=timezone.now)
    processed = models.BooleanField(default=False)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Inbound Event'
        verbose_name_plural = 'Inbound Events'
        indexes = [models.Index(fields=['integration', 'event_id'])]

    def __str__(self) -> str:  # pragma: no cover
        return f"InboundEvent({self.event_type} id={self.event_id})"


class Delivery(models.Model):
    """Outbound delivery record for notifying ERP about local events.

    The `payload` stores the JSON body sent, `event_type` indicates the
    ERP event (e.g., `order.fulfilled`, `inventory.qty_changed`). The
    `sent_at` and `status` fields track delivery progress for retries.
    """

    STATUS_PENDING = "PENDING"
    STATUS_SENT = "SENT"
    STATUS_FAILED = "FAILED"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SENT, "Sent"),
        (STATUS_FAILED, "Failed"),
    ]

    integration = models.ForeignKey(ERPIntegration, on_delete=models.CASCADE, related_name='deliveries')
    event_type = models.CharField(max_length=100, db_index=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    last_error = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Outbound Delivery'
        verbose_name_plural = 'Outbound Deliveries'
        indexes = [models.Index(fields=['integration', 'status'])]

    def __str__(self) -> str:  # pragma: no cover
        return f"Delivery({self.event_type} integration={self.integration_id} status={self.status})"
