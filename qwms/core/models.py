"""Core models for the WMS project.

Provides multi-tenant (Company) and warehouse location models:
- Company: the tenant / client that owns inventory
- Warehouse: physical warehouse belonging to a company
- Section: logical subdivision inside a warehouse (aisle/rack)
- BinType: reusable bin/shelf type with dimensions
- Bin: physical storage location (belongs to a Section)
- WarehouseUser: maps users to companies/warehouses with roles

These models are intentionally conservative and designed for
transactional inventory operations implemented in the `inventory` app.
"""

import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone
from django.contrib.auth import get_user_model

User = get_user_model()


class TimeStampedModel(models.Model):
    """Abstract model that provides created/updated timestamps."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Company(TimeStampedModel):
    """A customer / tenant that owns stock in warehouses.

    Keep this simple so it can be extended for billing or tenancy later.
    """

    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    vat_no = models.CharField(max_length=100, blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Company"
        verbose_name_plural = "Companies"
        ordering = ["name"]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.name} ({self.code})"

    def active_warehouses(self):
        return self.warehouse_set.filter(active=True)


class Warehouse(TimeStampedModel):
    """A physical warehouse.

    A Warehouse belongs to a Company. Multiple companies can share a warehouse
    in more advanced topologies, but this model keeps a simple ownership FK.
    """

    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    company = models.ForeignKey(Company, on_delete=models.PROTECT)
    address = models.TextField(blank=True, null=True)
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Warehouse"
        verbose_name_plural = "Warehouses"
        ordering = ["code"]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.code} - {self.name}"

    def sections(self):
        return self.section_set.all()

    def is_user_allowed(self, user: User) -> bool:
        """Check if a given user has access to this warehouse via mappings."""
        return WarehouseUser.objects.filter(user=user, warehouse=self, active=True).exists()


class Section(TimeStampedModel):
    """Logical subdivisions inside a warehouse (aisles, zones, levels).

    Sections are used to group bins and can carry strategy metadata later.
    """

    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE)
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    is_refrigerated = models.BooleanField(
        default=False,
        help_text="If true, this Section is temperature-controlled (refrigerated) and can store perishable items.",
    )

    class Meta:
        unique_together = (("warehouse", "code"),)
        ordering = ["warehouse", "code"]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.warehouse.code}:{self.code}"

    @property
    def bins(self):
        return self.bin_set.all()


class BinType(models.Model):
    """Template for bins (dimensions, capacity).

    Useful for validation and picking constraints.
    """

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    x_mm = models.PositiveIntegerField(default=0)
    y_mm = models.PositiveIntegerField(default=0)
    z_mm = models.PositiveIntegerField(default=0)
    max_weight_grams = models.PositiveIntegerField(default=0)
    static = models.BooleanField(default=False)
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Bin Type"
        verbose_name_plural = "Bin Types"
        ordering = ["name"]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.name


class Bin(TimeStampedModel):
    """Represents a physical storage location inside a Section.

    The combination (section, location_code) should be unique within the warehouse.
    We keep a UUID `code` as a stable external identifier suitable for barcodes.
    """

    code = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    section = models.ForeignKey(Section, on_delete=models.PROTECT)
    location_code = models.CharField(max_length=100)
    bin_type = models.ForeignKey(BinType, on_delete=models.PROTECT, null=True, blank=True)
    active = models.BooleanField(default=True)
    note = models.TextField(blank=True)

    class Meta:
        unique_together = (("section", "location_code"), ("warehouse", "code"))
        ordering = ["warehouse", "section", "location_code"]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.warehouse.code}:{self.section.code}:{self.location_code}"

    @property
    def label(self) -> dict:
        """Return a small JSON-friendly label useful for printing or barcode payloads."""
        return {
            "code": str(self.code),
            "barcode": f"BIN-{self.code}",
            "location": self.location_code,
            "warehouse": self.warehouse.code,
        }

    @property
    def company(self):
        return self.warehouse.company


class WarehouseUser(TimeStampedModel):
    """Maps a Django user to a Warehouse (or Company) with a role.

    Roles are intentionally simple: VIEWER, OPERATOR, ADMIN. Permissions in the
    API layer will map to these roles.
    """

    ROLE_VIEWER = 10
    ROLE_OPERATOR = 20
    ROLE_ADMIN = 30

    ROLE_CHOICES = ((ROLE_VIEWER, "viewer"), (ROLE_OPERATOR, "operator"), (ROLE_ADMIN, "admin"))

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, null=True, blank=True)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, null=True, blank=True)
    role = models.PositiveSmallIntegerField(choices=ROLE_CHOICES, default=ROLE_VIEWER)
    active = models.BooleanField(default=True)

    class Meta:
        unique_together = (("user", "company"), ("user", "warehouse"))
        ordering = ["user_id"]

    def __str__(self) -> str:  # pragma: no cover - trivial
        target = self.warehouse or self.company
        return f"{self.user.username} - {target} [{self.get_role_display()}]"

    def is_admin(self) -> bool:
        return self.role == self.ROLE_ADMIN and self.active


# Small utility functions that other apps can import

def get_user_companies(user: User):
    """Return active companies a user has access to."""
    # Companies explicitly assigned to the user via WarehouseUser.company
    explicit_company_qs = Company.objects.none()
    try:
        explicit_company_qs = Company.objects.filter(
            id__in=WarehouseUser.objects.filter(user=user, company__isnull=False, active=True).values_list(
                "company_id", flat=True
            )
        )
    except Exception:
        # If WarehouseUser isn't usable for some reason, fall back to implicit lookup
        explicit_company_qs = Company.objects.none()

    # Companies inferred from warehouses the user is bound to
    via_warehouses_qs = Company.objects.filter(warehouse__warehouseuser__user=user, active=True)

    # Union semantics: include both explicit company bindings and companies
    # derived from warehouse bindings
    return (explicit_company_qs | via_warehouses_qs).distinct()


def get_user_warehouses(user: User):
    """Return warehouses accessible to the user."""
    return Warehouse.objects.filter(warehouseuser__user=user, warehouseuser__active=True)
