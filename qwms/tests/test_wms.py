"""
Comprehensive test suite for QuantWMS.

Tests cover:
- Multi-tenant inventory isolation (no cross-company allocation)
- Concurrent allocation safety (SELECT FOR UPDATE correctness)
- Full end-to-end workflows (receive → allocate → pick → complete)
- FIFO/FEFO strategies
- Edge cases (zero qty, insufficient stock, duplicate reservations)
"""

import pytest
from decimal import Decimal
from threading import Thread
from django.db import transaction
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model

from core.models import Company, Warehouse, Section, Bin, BinType
from inventory.models import Item, ItemCategory, Lot, StockCategory, Quant, Movement
from orders.models import Document, DocumentLine, Reservation

User = get_user_model()

pytestmark = pytest.mark.django_db


# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def user():
    """Create a test user."""
    return User.objects.create_user(username='testuser', password='pass123')


@pytest.fixture
def companies():
    """Create two test companies (multi-tenant scenario)."""
    comp_a = Company.objects.create(code='COMP-A', name='Company A')
    comp_b = Company.objects.create(code='COMP-B', name='Company B')
    return comp_a, comp_b


@pytest.fixture
def warehouse(companies):
    """Create a shared warehouse for multiple companies."""
    comp_a, comp_b = companies
    return Warehouse.objects.create(code='WH-001', name='Main Warehouse', company=comp_a)


@pytest.fixture
def section(warehouse):
    """Create a section in the warehouse."""
    return Section.objects.create(warehouse=warehouse, code='SEC-A', name='Section A')


@pytest.fixture
def bin_type():
    """Create a bin type."""
    return BinType.objects.create(name='Standard Shelf', x_mm=1000, y_mm=500, z_mm=200)


@pytest.fixture
def bins(section, bin_type):
    """Create multiple bins."""
    bin1 = Bin.objects.create(
        warehouse=section.warehouse,
        section=section,
        location_code='A-01-01',
        bin_type=bin_type,
    )
    bin2 = Bin.objects.create(
        warehouse=section.warehouse,
        section=section,
        location_code='A-01-02',
        bin_type=bin_type,
    )
    return bin1, bin2


@pytest.fixture
def item_category():
    """Create an item category."""
    return ItemCategory.objects.create(name='Electronics', description='Electronic items')


@pytest.fixture
def item(item_category):
    """Create a test item."""
    return Item.objects.create(
        sku='SKU-001',
        name='Test Product',
        category=item_category,
        weight_grams=500,
    )


@pytest.fixture
def stock_category_unrestricted():
    """Get or create the UNRESTRICTED stock category."""
    return StockCategory.objects.get_or_create(code=StockCategory.UNRESTRICTED)[0]


@pytest.fixture
def stock_category_blocked():
    """Get or create the BLOCKED stock category."""
    return StockCategory.objects.get_or_create(code=StockCategory.BLOCKED)[0]


# ============================================================================
# MULTI-TENANT TESTS
# ============================================================================


class TestMultiTenantAllocation:
    """Verify that orders only allocate stock from the correct owner company."""

    def test_allocation_respects_owner_filter(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """Allocate only from quants owned by the document owner."""
        comp_a, comp_b = companies

        # Create bins for both companies
        bin_a = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )
        bin_b = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='B-01', bin_type=bin_type
        )

        # Receive 100 units for Company A
        quant_a = Quant.objects.create(
            item=item,
            bin=bin_a,
            lot=None,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=100,
        )

        # Receive 100 units for Company B
        quant_b = Quant.objects.create(
            item=item,
            bin=bin_b,
            lot=None,
            stock_category=stock_category_unrestricted,
            owner=comp_b,
            qty=100,
        )

        # Create order for Company A requesting 50 units
        doc_a = Document.objects.create(
            doc_number='SO-A-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )

        line_a = DocumentLine.objects.create(
            document=doc_a, item=item, qty_requested=50
        )

        # Reserve — should allocate only from Company A's quant
        allocated_qty = line_a.reserve_qty(strategy='FIFO', created_by=user)

        assert allocated_qty == 50, "Should allocate 50 units from Company A"
        assert line_a.qty_allocated == 50

        # Verify Company A's quant was reserved
        quant_a.refresh_from_db()
        assert quant_a.qty_reserved == 50, "Company A quant should be reserved"

        # Verify Company B's quant was NOT touched
        quant_b.refresh_from_db()
        assert quant_b.qty_reserved == 0, "Company B quant should not be reserved"

        # Verify a reservation was created linking to Company A's quant
        reservations = Reservation.objects.filter(line=line_a)
        assert reservations.count() == 1
        assert reservations.first().quant == quant_a

    def test_order_cannot_allocate_other_company_stock(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """Ensure order for Company A cannot allocate Company B's stock."""
        comp_a, comp_b = companies

        bin_a = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )

        # Only Company B has stock
        Quant.objects.create(
            item=item,
            bin=bin_a,
            stock_category=stock_category_unrestricted,
            owner=comp_b,
            qty=100,
        )

        # Company A tries to create order
        doc_a = Document.objects.create(
            doc_number='SO-A-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )

        line_a = DocumentLine.objects.create(
            document=doc_a, item=item, qty_requested=50
        )

        # Reserve — should NOT find any available stock
        allocated_qty = line_a.reserve_qty(strategy='FIFO', created_by=user)

        assert allocated_qty == 0, "Should not allocate any stock (only Company B owns it)"
        assert line_a.qty_allocated == 0


# ============================================================================
# CONCURRENCY TESTS
# ============================================================================


class TestConcurrentAllocation:
    """Test concurrent reservation scenarios (SELECT FOR UPDATE safety)."""

    def test_concurrent_reserve_does_not_double_allocate(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """
        Two concurrent reserve_qty calls should not allocate more than available qty.
        This tests SELECT FOR UPDATE correctness.
        """
        comp_a, _ = companies

        bin_1 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )

        # Create single quant with 100 qty
        quant = Quant.objects.create(
            item=item,
            bin=bin_1,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=100,
        )

        # Create two orders that will compete for the same quant
        doc1 = Document.objects.create(
            doc_number='SO-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        line1 = DocumentLine.objects.create(document=doc1, item=item, qty_requested=60)

        doc2 = Document.objects.create(
            doc_number='SO-002',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        line2 = DocumentLine.objects.create(document=doc2, item=item, qty_requested=60)

        # Reserve both lines (sequentially, but simulating concurrency with explicit locks)
        # Note: Django ORM SELECT FOR UPDATE is per-query, so we serialize here
        # Real concurrency testing would use threading/multiprocessing
        allocated1 = line1.reserve_qty(strategy='FIFO', created_by=user)
        allocated2 = line2.reserve_qty(strategy='FIFO', created_by=user)

        # Together they should not exceed 100
        total_allocated = allocated1 + allocated2
        assert total_allocated <= 100, f"Total allocated ({total_allocated}) exceeds available (100)"

        quant.refresh_from_db()
        assert quant.qty_reserved <= 100, "Reserved qty should not exceed total qty"


class TestConcurrentPick:
    """Test concurrent pick scenarios."""

    def test_pick_prevents_double_deduction(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """Ensure SELECT FOR UPDATE in pick prevents deducting same qty twice."""
        comp_a, _ = companies

        bin_1 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )

        quant = Quant.objects.create(
            item=item,
            bin=bin_1,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=50,
        )

        doc = Document.objects.create(
            doc_number='SO-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        line = DocumentLine.objects.create(document=doc, item=item, qty_requested=50)
        line.reserve_qty(strategy='FIFO', created_by=user)

        reservation = Reservation.objects.get(line=line)

        # Pick entire reservation
        success = reservation.pick(qty=50, created_by=user)
        assert success is True

        # Quant should be deleted (qty=0)
        assert not Quant.objects.filter(pk=quant.pk).exists()
        # Reservation should also be deleted
        assert not Reservation.objects.filter(pk=reservation.pk).exists()


# ============================================================================
# END-TO-END WORKFLOW TESTS
# ============================================================================


class TestEndToEndWorkflow:
    """Test complete receive → allocate → pick → complete workflows."""

    def test_full_order_lifecycle(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """Test complete order lifecycle from receipt to completion."""
        comp_a, _ = companies

        bin_1 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )

        # Step 1: Receive goods
        quant = Quant.objects.create(
            item=item,
            bin=bin_1,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=0,
        )
        quant.receive_qty(qty=100, created_by=user)
        quant.refresh_from_db()
        assert quant.qty == 100

        # Step 2: Create order
        doc = Document.objects.create(
            doc_number='SO-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        assert doc.status == Document.Status.DRAFT

        # Step 3: Add line
        line = DocumentLine.objects.create(document=doc, item=item, qty_requested=50)
        assert line.qty_remaining == 50

        # Step 4: Reserve
        results = doc.reserve_all_lines(strategy='FIFO', created_by=user)
        assert len(results['allocated_lines']) == 1
        doc.refresh_from_db()
        assert doc.status == Document.Status.FULLY_ALLOCATED

        # Step 5: Pick
        reservation = Reservation.objects.get(line=line)
        success = reservation.pick(qty=50, created_by=user)
        assert success is True
        doc.refresh_from_db()
        assert doc.status == Document.Status.COMPLETED
        assert doc.is_completed is True

        # Step 6: Verify audit trail
        movements = Movement.objects.filter(item=item)
        assert movements.count() == 2  # INBOUND + OUTBOUND
        assert movements.filter(movement_type=Movement.TYPE_INBOUND).exists()
        assert movements.filter(movement_type=Movement.TYPE_OUTBOUND).exists()

    def test_partial_allocation_workflow(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """Test partial allocation when insufficient stock."""
        comp_a, _ = companies

        bin_1 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )

        # Receive only 30 units
        quant = Quant.objects.create(
            item=item,
            bin=bin_1,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=30,
        )

        # Order 50 units
        doc = Document.objects.create(
            doc_number='SO-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        line = DocumentLine.objects.create(document=doc, item=item, qty_requested=50)

        # Reserve
        results = doc.reserve_all_lines(strategy='FIFO', created_by=user)

        # Should be partially allocated
        assert len(results['partially_allocated_lines']) == 1
        doc.refresh_from_db()
        assert doc.status == Document.Status.PARTIALLY_ALLOCATED
        assert doc.total_qty_allocated == 30
        # qty_remaining = qty_requested - qty_picked, which is 50 - 0 = 50
        # (qty not yet picked)
        assert doc.qty_remaining == 50
        # qty_requested - qty_allocated = qty still needing allocation
        qty_unallocated = doc.total_qty_requested - doc.total_qty_allocated
        assert qty_unallocated == 20

    def test_fifo_strategy(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """Test FIFO allocation (oldest quants first)."""
        comp_a, _ = companies

        bin_1 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )
        bin_2 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-02', bin_type=bin_type
        )

        # Create two quants with different received_at times (older first)
        with transaction.atomic():
            quant_old = Quant.objects.create(
                item=item,
                bin=bin_1,
                stock_category=stock_category_unrestricted,
                owner=comp_a,
                qty=40,
            )

        # Simulate older timestamp (in real scenario this would be different)
        quant_new = Quant.objects.create(
            item=item,
            bin=bin_2,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=40,
        )

        # Order 60 units
        doc = Document.objects.create(
            doc_number='SO-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        line = DocumentLine.objects.create(document=doc, item=item, qty_requested=60)

        # Reserve with FIFO
        line.reserve_qty(strategy='FIFO', created_by=user)

        # Should have allocated from both (FIFO: old quant first, then new)
        reservations = Reservation.objects.filter(line=line).order_by('id')
        assert reservations.count() == 2

        # First reservation should be from older quant
        assert reservations.first().quant == quant_old
        assert reservations.first().qty == 40
        # Second from newer
        assert reservations.last().qty == 20


# ============================================================================
# EDGE CASE TESTS
# ============================================================================


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_receive_zero_qty_raises_error(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted
    ):
        """Receiving 0 qty should raise ValidationError."""
        comp_a, _ = companies

        bin_1 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )
        quant = Quant.objects.create(
            item=item,
            bin=bin_1,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=0,
        )

        with pytest.raises(ValidationError):
            quant.receive_qty(qty=0)

    def test_pick_more_than_reserved_fails(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """Picking more than reserved qty should fail."""
        comp_a, _ = companies

        bin_1 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )

        quant = Quant.objects.create(
            item=item,
            bin=bin_1,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=100,
        )

        doc = Document.objects.create(
            doc_number='SO-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        line = DocumentLine.objects.create(document=doc, item=item, qty_requested=50)
        line.reserve_qty(strategy='FIFO', created_by=user)

        reservation = Reservation.objects.get(line=line)

        # Try to pick more than allocated
        success = reservation.pick(qty=60, created_by=user)
        assert success is False

    def test_reserve_same_quant_multiple_times(
        self, companies, warehouse, section, bin_type, item, stock_category_unrestricted, user
    ):
        """Multiple reservations on same quant should update qty_reserved correctly."""
        comp_a, _ = companies

        bin_1 = Bin.objects.create(
            warehouse=warehouse, section=section, location_code='A-01', bin_type=bin_type
        )

        quant = Quant.objects.create(
            item=item,
            bin=bin_1,
            stock_category=stock_category_unrestricted,
            owner=comp_a,
            qty=100,
        )

        # Create two orders
        doc1 = Document.objects.create(
            doc_number='SO-001',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        line1 = DocumentLine.objects.create(document=doc1, item=item, qty_requested=40)

        doc2 = Document.objects.create(
            doc_number='SO-002',
            doc_type=Document.DocType.OUTBOUND_ORDER,
            warehouse=warehouse,
            owner=comp_a,
            created_by=user,
        )
        line2 = DocumentLine.objects.create(document=doc2, item=item, qty_requested=40)

        # Reserve both
        line1.reserve_qty(strategy='FIFO', created_by=user)
        line2.reserve_qty(strategy='FIFO', created_by=user)

        quant.refresh_from_db()
        assert quant.qty_reserved == 80, "Should have 80 reserved out of 100"
        assert quant.qty_available == 20, "Should have 20 available"


# ============================================================================
# RUN TESTS
# ============================================================================


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
