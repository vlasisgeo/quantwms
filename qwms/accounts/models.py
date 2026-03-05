from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone

from core.models import Company, Warehouse

User = get_user_model()


class Membership(models.Model):
    ROLE_OWNER = 'owner'
    ROLE_ADMIN = 'admin'
    ROLE_STAFF = 'staff'

    ROLE_CHOICES = [
        (ROLE_OWNER, 'Owner'),
        (ROLE_ADMIN, 'Admin'),
        (ROLE_STAFF, 'Staff'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='memberships')
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='members')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_STAFF)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = (('user', 'company'),)

    def __str__(self) -> str:
        return f"{self.user} @ {self.company} ({self.role})"


class WarehouseAssignment(models.Model):
    """Assign a user to a warehouse so they can operate on that warehouse's data.

    Per product decision: staff users assigned to a warehouse can see quants/orders
    for that warehouse across companies (implemented in permission checks).
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='warehouse_assignments')
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='assignments')
    can_manage = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = (('user', 'warehouse'),)

    def __str__(self) -> str:
        return f"{self.user} -> {self.warehouse} (manage={self.can_manage})"


class CompanyWebhook(models.Model):
    """A URL that receives HTTP POST callbacks when WMS events occur.

    Register one or more URLs per company.  The ``event_types`` list
    controls which events trigger a delivery.

    Supported event types:
        fulfil.success   — all lines fully allocated
        fulfil.partial   — some lines could not be allocated
        fulfil.failed    — document creation or reservation failed entirely
    """

    EVENT_FULFIL_SUCCESS = "fulfil.success"
    EVENT_FULFIL_PARTIAL = "fulfil.partial"
    EVENT_FULFIL_FAILED = "fulfil.failed"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="webhooks")
    url = models.URLField(max_length=500)
    event_types = models.JSONField(
        default=list,
        help_text='JSON list, e.g. ["fulfil.success","fulfil.partial","fulfil.failed"]',
    )
    active = models.BooleanField(default=True)
    secret = models.CharField(
        max_length=200,
        blank=True,
        help_text="Optional HMAC-SHA256 secret.  Signature sent as X-WMS-Signature header.",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "Company Webhook"
        verbose_name_plural = "Company Webhooks"

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.company} → {self.url}"
