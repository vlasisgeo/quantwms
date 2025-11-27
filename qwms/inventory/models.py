"""Inventory models for the WMS project.

Core inventory operations:
- Item: products/SKUs
- Lot/Batch: production batches with optional expiry
- StockCategory: unrestricted, blocked, quality, consignment
- Quant: canonical inventory unit (item + bin + lot + category + owner + qty)
- Movement: immutable audit log of all inventory transactions

Transactional methods on Quant and utility functions ensure
atomicity and prevent double-allocations under concurrency.
"""

from decimal import Decimal
from typing import Tuple, Optional, List
from datetime import date

from django.db import models, transaction
from django.db.models import Sum, F, Q
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model

from core.models import TimeStampedModel, Bin, Company, Warehouse

User = get_user_model()


class ItemCategory(TimeStampedModel):
    """Categorizes items (e.g., Electronics, Fragile, Hazardous)."""

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Item Category"
        verbose_name_plural = "Item Categories"
        ordering = ["name"]

    def __str__(self) -> str:  # pragma: no cover
        return self.name


class Item(TimeStampedModel):
    """Represents a product/SKU in the system."""

    sku = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    category = models.ForeignKey(ItemCategory, on_delete=models.SET_NULL, null=True, blank=True)
    
    # Dimensions in mm
    length_mm = models.PositiveIntegerField(default=0)
    width_mm = models.PositiveIntegerField(default=0)
    height_mm = models.PositiveIntegerField(default=0)
    
    # Weight in grams
    weight_grams = models.PositiveIntegerField(default=0)
    
    # Handling flags
    fragile = models.BooleanField(default=False)
    hazardous = models.BooleanField(default=False)
    
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Item"
        verbose_name_plural = "Items"
        ordering = ["sku"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.sku} - {self.name}"

    @property
    def volume_mm3(self) -> int:
        """Volume in cubic millimeters."""
        return self.length_mm * self.width_mm * self.height_mm


class Lot(TimeStampedModel):
    """Production lot / batch for tracking and expiry management."""

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="lots")
    lot_code = models.CharField(max_length=100)
    expiry_date = models.DateField(null=True, blank=True)
    manufacture_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        unique_together = (("item", "lot_code"),)
        ordering = ["item", "lot_code"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.item.sku}:{self.lot_code}"

    @property
    def is_expired(self) -> bool:
        """Check if the lot has expired (as of today)."""
        if not self.expiry_date:
            return False
        return self.expiry_date <= timezone.now().date()

    @property
    def days_to_expiry(self) -> Optional[int]:
        """Days until expiry, or None if no expiry date."""
        if not self.expiry_date:
            return None
        return (self.expiry_date - timezone.now().date()).days


class StockCategory(models.Model):
    """Categories for stock status (e.g., Unrestricted, Blocked, Quality Inspection, Consignment)."""

    UNRESTRICTED = "UNRESTRICTED"
    BLOCKED = "BLOCKED"
    QUALITY_CHECK = "QUALITY_CHECK"
    CONSIGNMENT = "CONSIGNMENT"

    CATEGORY_CHOICES = [
        (UNRESTRICTED, "Unrestricted"),
        (BLOCKED, "Blocked"),
        (QUALITY_CHECK, "Quality Check"),
        (CONSIGNMENT, "Consignment"),
    ]

    code = models.CharField(max_length=50, primary_key=True, choices=CATEGORY_CHOICES)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)

    class Meta:
        verbose_name = "Stock Category"
        verbose_name_plural = "Stock Categories"

    def __str__(self) -> str:  # pragma: no cover
        return self.name


class Quant(TimeStampedModel):
    """Canonical inventory unit: the item + location + lot + category.

    Represents actual stock at a bin for a specific item/lot/category.
    Multiple quants can exist for the same item in different bins or with different lots.

    Owner is typically the Company that owns the stock (for multi-tenant support).
    Qty is always >= 0 (we delete zero quants).
    """

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="quants")
    bin = models.ForeignKey(Bin, on_delete=models.PROTECT, related_name="quants")
    lot = models.ForeignKey(Lot, on_delete=models.SET_NULL, null=True, blank=True, related_name="quants")
    stock_category = models.ForeignKey(StockCategory, on_delete=models.PROTECT, default=StockCategory.UNRESTRICTED)
    owner = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="quants")
    
    qty = models.PositiveIntegerField(default=0)
    
    # For received goods: when was it received
    received_at = models.DateTimeField(default=timezone.now)
    
    # Reserved qty (reserved for orders but not yet picked)
    qty_reserved = models.PositiveIntegerField(default=0)

    class Meta:
        # Enforce uniqueness: one quant per (item, bin, lot, category, owner)
        unique_together = (("item", "bin", "lot", "stock_category", "owner"),)
        ordering = ["received_at", "id"]
        indexes = [
            models.Index(fields=["item", "bin"]),
            models.Index(fields=["item", "owner"]),
            models.Index(fields=["bin"]),
            models.Index(fields=["stock_category"]),
        ]

    def __str__(self) -> str:  # pragma: no cover
        lot_str = f":{self.lot.lot_code}" if self.lot else ""
        return f"Quant({self.item.sku}@{self.bin.location_code}{lot_str}, qty={self.qty})"

    @property
    def qty_available(self) -> int:
        """Available qty = total qty - reserved qty."""
        return max(0, self.qty - self.qty_reserved)

    @transaction.atomic
    def receive_qty(self, qty: int, created_by: User = None) -> "Quant":
        """
        Add quantity to this quant (or create if doesn't exist).
        
        Args:
            qty: quantity to add
            created_by: user performing the receipt
            
        Returns:
            self (the updated or created Quant)
        """
        if qty <= 0:
            raise ValidationError("Quantity must be > 0")

        self.qty += qty
        self.save()

        # Log the movement
        Movement.objects.create(
            from_quant=None,
            to_quant=self,
            item=self.item,
            qty=qty,
            movement_type=Movement.TYPE_INBOUND,
            warehouse=self.bin.warehouse,
            created_by=created_by,
            reference="receive_goods",
        )

        return self

    @transaction.atomic
    def reserve_qty(self, qty: int, created_by: User = None) -> bool:
        """
        Reserve quantity on this quant (for order allocation).
        Uses SELECT FOR UPDATE to prevent race conditions.
        
        Args:
            qty: quantity to reserve
            created_by: user performing the reservation
            
        Returns:
            True if reservation succeeded, False if insufficient available qty
        """
        if qty <= 0:
            raise ValidationError("Reservation qty must be > 0")

        # Lock the row
        locked_quant = Quant.objects.select_for_update().get(pk=self.pk)

        if locked_quant.qty_available < qty:
            return False

        locked_quant.qty_reserved += qty
        locked_quant.save()

        # Log the movement (reserve doesn't deduct yet, just marks reserved)
        Movement.objects.create(
            from_quant=self,
            to_quant=self,
            item=self.item,
            qty=qty,
            movement_type=Movement.TYPE_RESERVED,
            warehouse=self.bin.warehouse,
            created_by=created_by,
            reference="reserve_qty",
        )

        return True

    @transaction.atomic
    def pick_qty(self, qty: int, created_by: User = None) -> bool:
        """
        Execute a pick: deduct reserved/available qty from this quant.
        Uses SELECT FOR UPDATE to prevent double-picks.
        
        Args:
            qty: quantity to pick
            created_by: user performing the pick
            
        Returns:
            True if pick succeeded, False if insufficient available qty
        """
        if qty <= 0:
            raise ValidationError("Pick qty must be > 0")

        # Lock the row
        locked_quant = Quant.objects.select_for_update().get(pk=self.pk)

        if locked_quant.qty_available < qty:
            return False

        # Deduct from reserved first, then from qty if needed
        deduct_from_reserved = min(qty, locked_quant.qty_reserved)
        deduct_from_qty = qty - deduct_from_reserved

        locked_quant.qty_reserved -= deduct_from_reserved
        locked_quant.qty -= deduct_from_qty
        locked_quant.save()

        # Log the movement
        Movement.objects.create(
            from_quant=self,
            to_quant=None,
            item=self.item,
            qty=qty,
            movement_type=Movement.TYPE_OUTBOUND,
            warehouse=self.bin.warehouse,
            created_by=created_by,
            reference="pick_qty",
        )

        # Delete if qty is now 0
        if locked_quant.qty == 0:
            locked_quant.delete()

        return True

    @transaction.atomic
    def transfer_qty(self, target_quant: "Quant", qty: int, created_by: User = None) -> bool:
        """
        Transfer quantity from this quant to another (same item, different bin/lot).
        Uses SELECT FOR UPDATE on both quants.
        
        Args:
            target_quant: destination Quant
            qty: quantity to move
            created_by: user performing the transfer
            
        Returns:
            True if transfer succeeded, False if insufficient qty
        """
        if qty <= 0:
            raise ValidationError("Transfer qty must be > 0")

        if self.item != target_quant.item:
            raise ValidationError("Source and target quants must have the same item")

        # Lock both rows (always lock in consistent order to avoid deadlock)
        ids_sorted = sorted([self.pk, target_quant.pk])
        locked_quants = list(
            Quant.objects.filter(pk__in=ids_sorted).select_for_update().order_by("pk")
        )
        if len(locked_quants) != 2:
            raise ValidationError("One or both quants not found")

        source = locked_quants[0] if locked_quants[0].pk == self.pk else locked_quants[1]
        target = locked_quants[1] if source.pk == locked_quants[0].pk else locked_quants[0]

        if source.qty_available < qty:
            return False

        # Deduct from source
        source.qty -= qty
        source.save()

        # Add to target
        target.qty += qty
        target.save()

        # Delete source if qty is now 0
        if source.qty == 0:
            source.delete()

        # Log the movement
        Movement.objects.create(
            from_quant=self,
            to_quant=target,
            item=self.item,
            qty=qty,
            movement_type=Movement.TYPE_TRANSFER,
            warehouse=self.bin.warehouse,
            created_by=created_by,
            reference="transfer_qty",
        )

        return True


class Movement(models.Model):
    """Immutable audit log of all inventory transactions.
    
    Records every receipt, reservation, pick, and transfer for traceability.
    """

    TYPE_INBOUND = "INBOUND"
    TYPE_RESERVED = "RESERVED"
    TYPE_OUTBOUND = "OUTBOUND"
    TYPE_TRANSFER = "TRANSFER"
    TYPE_ADJUSTMENT = "ADJUSTMENT"

    MOVEMENT_TYPES = [
        (TYPE_INBOUND, "Goods In"),
        (TYPE_RESERVED, "Reserved"),
        (TYPE_OUTBOUND, "Goods Out"),
        (TYPE_TRANSFER, "Transfer"),
        (TYPE_ADJUSTMENT, "Adjustment"),
    ]

    from_quant = models.ForeignKey(
        Quant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movements_from",
    )
    to_quant = models.ForeignKey(
        Quant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movements_to",
    )
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="movements")
    qty = models.PositiveIntegerField()
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_TYPES)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Movement"
        verbose_name_plural = "Movements"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["item", "-created_at"]),
            models.Index(fields=["warehouse", "-created_at"]),
            models.Index(fields=["-created_at"]),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.movement_type}:{self.item.sku}@{self.created_at}"


# Utility functions

def get_inventory_by_item(item: Item, warehouse: Warehouse = None, owner: Company = None) -> dict:
    """
    Get total inventory snapshot for an item.
    
    Args:
        item: the Item to query
        warehouse: optional filter by warehouse
        owner: optional filter by company owner
        
    Returns:
        dict with total_qty, total_reserved, total_available, by_bin breakdown
    """
    quants = Quant.objects.filter(item=item)
    
    if warehouse:
        quants = quants.filter(bin__warehouse=warehouse)
    
    if owner:
        quants = quants.filter(owner=owner)
    
    total_qty = quants.aggregate(Sum("qty"))["qty__sum"] or 0
    total_reserved = quants.aggregate(Sum("qty_reserved"))["qty_reserved__sum"] or 0
    total_available = total_qty - total_reserved
    
    by_bin = []
    for quant in quants:
        by_bin.append({
            "bin": str(quant.bin),
            "lot": quant.lot.lot_code if quant.lot else None,
            "category": quant.stock_category.code,
            "qty": quant.qty,
            "reserved": quant.qty_reserved,
            "available": quant.qty_available,
        })
    
    return {
        "item_sku": item.sku,
        "total_qty": total_qty,
        "total_reserved": total_reserved,
        "total_available": total_available,
        "by_bin": by_bin,
    }


def get_inventory_by_bin(bin: Bin) -> dict:
    """Get all inventory in a specific bin."""
    quants = Quant.objects.filter(bin=bin)
    
    items = []
    for quant in quants:
        items.append({
            "item_sku": quant.item.sku,
            "item_name": quant.item.name,
            "lot": quant.lot.lot_code if quant.lot else None,
            "category": quant.stock_category.code,
            "qty": quant.qty,
            "reserved": quant.qty_reserved,
            "available": quant.qty_available,
        })
    
    return {
        "bin": str(bin),
        "items": items,
        "total_slots": len(items),
    }

