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
