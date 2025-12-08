from django.db import models
from django.utils import timezone

from core.models import Company


class ERPIntegration(models.Model):
    """Per-company ERP integration configuration."""

    name = models.CharField(max_length=200)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='erp_integrations')
    description = models.TextField(blank=True)

    # Secret used by ERP to sign inbound webhook payloads (HMAC-SHA256)
    inbound_secret = models.CharField(max_length=200, blank=True)

    # If we implement outbound calls, store base URL and credentials here
    outbound_base_url = models.URLField(blank=True)
    outbound_auth_token = models.CharField(max_length=200, blank=True)

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
