"""Order and reservation models for the WMS project.

Document lifecycle:
1. Document created (pending)
2. DocumentLines added with requested quantities
3. Reservations created (allocation from Quants)
4. Picks executed (quants deducted)
5. Document completed

Key workflows:
- reserve_all_lines(): allocate all lines or partial
- pick_reservation(): execute a single pick
- complete_document(): finalize when all picks done
"""

from decimal import Decimal
from typing import List, Tuple, Optional
from enum import IntEnum

from django.db import models, transaction
from django.db.models import Sum, F, Q
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model

from core.models import TimeStampedModel, Warehouse, Company
from inventory.models import Item, Quant, Movement, StockCategory

User = get_user_model()


class Document(TimeStampedModel):
    """Represents an order, transfer, or delivery document."""

    class DocType(IntEnum):
        OUTBOUND_ORDER = 100  # customer delivery
        TRANSFER_ORDER = 110  # warehouse-to-warehouse
        INBOUND_RECEIPT = 120  # supplier receipt
        ADJUSTMENT = 130  # inventory adjustment

    DOC_TYPE_CHOICES = [
        (DocType.OUTBOUND_ORDER, "Outbound Order"),
        (DocType.TRANSFER_ORDER, "Transfer Order"),
        (DocType.INBOUND_RECEIPT, "Inbound Receipt"),
        (DocType.ADJUSTMENT, "Adjustment"),
    ]

    class Status(IntEnum):
        DRAFT = 10
        PENDING = 20
        PARTIALLY_ALLOCATED = 30
        FULLY_ALLOCATED = 40
        PARTIALLY_PICKED = 50
        FULLY_PICKED = 60
        COMPLETED = 70
        CANCELED = 80

    STATUS_CHOICES = [
        (Status.DRAFT, "Draft"),
        (Status.PENDING, "Pending"),
        (Status.PARTIALLY_ALLOCATED, "Partially Allocated"),
        (Status.FULLY_ALLOCATED, "Fully Allocated"),
        (Status.PARTIALLY_PICKED, "Partially Picked"),
        (Status.FULLY_PICKED, "Fully Picked"),
        (Status.COMPLETED, "Completed"),
        (Status.CANCELED, "Canceled"),
    ]

    doc_number = models.CharField(max_length=100, unique=True)
    doc_type = models.IntegerField(choices=DOC_TYPE_CHOICES, default=DocType.OUTBOUND_ORDER)
    status = models.IntegerField(choices=STATUS_CHOICES, default=Status.DRAFT)
    
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    warehouse_to = models.ForeignKey(
        Warehouse,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transfer_documents_to",
        help_text="For transfer orders: destination warehouse",
    )
    company = models.ForeignKey(Company, on_delete=models.PROTECT, null=True, blank=True)
    owner = models.ForeignKey(
        Company,
        on_delete=models.PROTECT,
        related_name="owned_documents",
        help_text="Company that owns/controls this document",
    )
    
    erp_doc_number = models.CharField(max_length=100, blank=True, help_text="External ERP reference")
    notes = models.TextField(blank=True)
    
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        verbose_name = "Document"
        verbose_name_plural = "Documents"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["doc_number"]),
            models.Index(fields=["status"]),
            models.Index(fields=["warehouse", "status"]),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.doc_number} ({self.get_status_display()})"

    @property
    def total_qty_requested(self) -> int:
        """Sum of all line quantities."""
        return self.lines.aggregate(total=Sum("qty_requested"))["total"] or 0

    @property
    def total_qty_allocated(self) -> int:
        """Sum of all allocated quantities."""
        return self.lines.aggregate(total=Sum("qty_allocated"))["total"] or 0

    @property
    def total_qty_picked(self) -> int:
        """Sum of all picked quantities."""
        return self.lines.aggregate(total=Sum("qty_picked"))["total"] or 0

    @property
    def qty_remaining(self) -> int:
        """Qty still needing to be picked."""
        return self.total_qty_requested - self.total_qty_picked

    @property
    def is_completed(self) -> bool:
        """Check if all lines are fully picked."""
        return self.qty_remaining == 0

    @transaction.atomic
    def reserve_all_lines(self, strategy: str = "FIFO", created_by: User = None) -> dict:
        """
        Attempt to allocate all document lines to available quants.
        
        Args:
            strategy: allocation strategy (FIFO, FEFO for expiry-based)
            created_by: user performing reservation
            
        Returns:
            dict with allocated_lines, partially_allocated_lines, unallocated_lines
        """
        results = {
            "allocated_lines": [],
            "partially_allocated_lines": [],
            "unallocated_lines": [],
        }

        for line in self.lines.all():
            allocated_qty = line.reserve_qty(strategy=strategy, created_by=created_by)
            
            if allocated_qty == 0:
                results["unallocated_lines"].append(line.id)
            elif allocated_qty < line.qty_requested:
                results["partially_allocated_lines"].append(
                    {"line_id": line.id, "allocated": allocated_qty, "requested": line.qty_requested}
                )
            else:
                results["allocated_lines"].append(line.id)

        # Update document status
        self._update_status()

        return results

    def _update_status(self):
        """Update document status based on allocation/pick progress."""
        if self.total_qty_picked == self.total_qty_requested:
            self.status = self.Status.COMPLETED
        elif self.total_qty_picked > 0:
            self.status = self.Status.PARTIALLY_PICKED
        elif self.total_qty_allocated == self.total_qty_requested:
            self.status = self.Status.FULLY_ALLOCATED
        elif self.total_qty_allocated > 0:
            self.status = self.Status.PARTIALLY_ALLOCATED
        elif self.status == self.Status.DRAFT:
            pass  # stay in draft
        else:
            self.status = self.Status.PENDING

        self.save()

    @transaction.atomic
    def cancel(self, created_by: User = None):
        """Cancel document and release all reservations."""
        for line in self.lines.all():
            line.unreserve_all(created_by=created_by)
        
        self.status = self.Status.CANCELED
        self.save()


class DocumentLine(TimeStampedModel):
    """A line item in a Document (item + qty)."""

    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    
    qty_requested = models.PositiveIntegerField()
    qty_allocated = models.PositiveIntegerField(default=0)
    qty_picked = models.PositiveIntegerField(default=0)
    
    price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = "Document Line"
        verbose_name_plural = "Document Lines"
        ordering = ["document", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.document.doc_number}:{self.item.sku}"

    @property
    def qty_remaining(self) -> int:
        """Qty still needing to be picked."""
        return self.qty_requested - self.qty_picked

    @transaction.atomic
    def reserve_qty(self, strategy: str = "FIFO", created_by: User = None) -> int:
        """
        Allocate this line to available quants using a strategy.
        
        Args:
            strategy: FIFO (oldest first) or FEFO (earliest expiry first)
            created_by: user performing allocation
            
        Returns:
            total qty allocated to this line
        """
        if self.qty_remaining <= 0:
            return 0

        remaining_to_allocate = self.qty_remaining
        warehouse = self.document.warehouse

        # Get candidate quants (available, not expired, unrestricted or specified category)
        quants = Quant.objects.filter(
            item=self.item,
            bin__warehouse=warehouse,
            stock_category=StockCategory.UNRESTRICTED,
        ).select_for_update()

        # Sort by strategy
        if strategy == "FEFO":
            quants = quants.filter(lot__isnull=False).order_by("lot__expiry_date", "received_at")
        else:  # FIFO
            quants = quants.order_by("received_at", "id")

        allocated_this_line = 0
        for quant in quants:
            if remaining_to_allocate <= 0:
                break

            if quant.qty_available <= 0:
                continue

            # How much can we take from this quant
            to_reserve = min(remaining_to_allocate, quant.qty_available)

            # Create a Reservation record
            reservation = Reservation.objects.create(
                line=self,
                quant=quant,
                qty=to_reserve,
            )

            # Update quant's reserved count
            quant.qty_reserved += to_reserve
            quant.save()

            allocated_this_line += to_reserve
            remaining_to_allocate -= to_reserve

        # Update line's allocated qty
        self.qty_allocated += allocated_this_line
        self.save()

        return allocated_this_line

    @transaction.atomic
    def unreserve_all(self, created_by: User = None):
        """Release all reservations for this line."""
        for reservation in self.reservations.all():
            reservation.unreserve(created_by=created_by)
        
        self.qty_allocated = 0
        self.save()


class Reservation(TimeStampedModel):
    """A specific allocation of a Quant to a DocumentLine.
    
    This is the "link" between an order line and physical inventory.
    When we pick this reservation, we deduct from the quant.
    """

    line = models.ForeignKey(DocumentLine, on_delete=models.CASCADE, related_name="reservations")
    quant = models.ForeignKey(Quant, on_delete=models.PROTECT, related_name="reservations")
    qty = models.PositiveIntegerField()
    qty_picked = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Reservation"
        verbose_name_plural = "Reservations"
        ordering = ["line", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"Res({self.line.document.doc_number}:{self.quant.item.sku}, qty={self.qty})"

    @property
    def qty_remaining(self) -> int:
        """Qty of this reservation still needing to be picked."""
        return self.qty - self.qty_picked

    @transaction.atomic
    def pick(self, qty: int = None, created_by: User = None) -> bool:
        """
        Execute a pick on this reservation.
        
        Args:
            qty: if None, pick all remaining; else pick this amount
            created_by: user performing pick
            
        Returns:
            True if successful, False if insufficient qty
        """
        if qty is None:
            qty = self.qty_remaining

        if qty <= 0:
            raise ValidationError("Pick qty must be > 0")

        if qty > self.qty_remaining:
            return False

        # Lock and deduct from the quant
        locked_quant = Quant.objects.select_for_update().get(pk=self.quant.pk)
        
        if locked_quant.qty < qty:
            return False

        # Deduct from quant
        locked_quant.qty -= qty
        locked_quant.qty_reserved -= qty
        locked_quant.save()

        # Update reservation pick count
        self.qty_picked += qty
        self.save()

        # Update document line pick count
        self.line.qty_picked += qty
        self.line.save()

        # Log the movement
        Movement.objects.create(
            from_quant=self.quant,
            to_quant=None,
            item=self.line.item,
            qty=qty,
            movement_type=Movement.TYPE_OUTBOUND,
            warehouse=self.line.document.warehouse,
            created_by=created_by,
            reference=f"pick:{self.line.document.doc_number}",
        )

        # Delete quant if qty is 0
        if locked_quant.qty == 0:
            locked_quant.delete()

        # Update document status
        self.line.document._update_status()

        return True

    @transaction.atomic
    def unreserve(self, created_by: User = None):
        """Release this reservation (undo allocation)."""
        # Release the reserved qty back to the quant
        locked_quant = Quant.objects.select_for_update().get(pk=self.quant.pk)
        locked_quant.qty_reserved -= self.qty
        locked_quant.save()

        # Log the movement (cancel reservation)
        Movement.objects.create(
            from_quant=self.quant,
            to_quant=self.quant,
            item=self.line.item,
            qty=self.qty,
            movement_type=Movement.TYPE_RESERVED,
            warehouse=self.line.document.warehouse,
            created_by=created_by,
            reference=f"unreserve:{self.line.document.doc_number}",
        )

        self.delete()

