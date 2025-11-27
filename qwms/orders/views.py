"""Views and viewsets for orders app."""

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.core.exceptions import ValidationError
from django.db.models import F

from orders.models import Document, DocumentLine, Reservation
from orders.serializers import (
    DocumentSerializer,
    DocumentLineSerializer,
    ReservationSerializer,
    CreateDocumentSerializer,
    AddDocumentLineSerializer,
    ReserveDocumentSerializer,
    PickReservationSerializer,
)
from inventory.models import Item
from core.models import Warehouse, Company


class DocumentViewSet(viewsets.ModelViewSet):
    """ViewSet for Document (order/transfer/receipt)."""

    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["warehouse", "owner", "status", "doc_type"]

    @action(detail=False, methods=["post"])
    def create_document(self, request):
        """
        Create a new Document.
        POST /api/documents/create_document/
        {
            "doc_number": "SO-001",
            "doc_type": 100,
            "warehouse_id": 1,
            "owner_id": 1,
            "erp_doc_number": "ERP-001",
            "notes": "Customer order"
        }
        """
        serializer = CreateDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            warehouse = Warehouse.objects.get(id=serializer.data["warehouse_id"])
        except Warehouse.DoesNotExist:
            return Response(
                {"error": "Warehouse not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        warehouse_to = None
        if serializer.data.get("warehouse_to_id"):
            try:
                warehouse_to = Warehouse.objects.get(id=serializer.data["warehouse_to_id"])
            except Warehouse.DoesNotExist:
                return Response(
                    {"error": "Destination warehouse not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        try:
            owner = Company.objects.get(id=serializer.data["owner_id"])
        except Company.DoesNotExist:
            return Response(
                {"error": "Owner (Company) not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        doc = Document.objects.create(
            doc_number=serializer.data["doc_number"],
            doc_type=serializer.data["doc_type"],
            warehouse=warehouse,
            warehouse_to=warehouse_to,
            owner=owner,
            erp_doc_number=serializer.data.get("erp_doc_number", ""),
            notes=serializer.data.get("notes", ""),
            created_by=request.user,
        )

        return Response(
            DocumentSerializer(doc).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def add_line(self, request, pk=None):
        """
        Add a line to a Document.
        POST /api/documents/{id}/add_line/
        {
            "item_sku": "SKU-001",
            "qty_requested": 100,
            "price": "10.50",
            "discount_percent": "5.00"
        }
        """
        doc = self.get_object()
        serializer = AddDocumentLineSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            item = Item.objects.get(sku=serializer.data["item_sku"])
        except Item.DoesNotExist:
            return Response(
                {"error": "Item not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        line = DocumentLine.objects.create(
            document=doc,
            item=item,
            qty_requested=serializer.data["qty_requested"],
            price=serializer.data.get("price"),
            discount_percent=serializer.data.get("discount_percent", 0),
            notes=serializer.data.get("notes", ""),
        )

        return Response(
            DocumentLineSerializer(line).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def reserve(self, request, pk=None):
        """
        Reserve all lines in a Document.
        POST /api/documents/{id}/reserve/
        {
            "strategy": "FIFO"
        }
        """
        doc = self.get_object()
        serializer = ReserveDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        results = doc.reserve_all_lines(
            strategy=serializer.data.get("strategy", "FIFO"),
            created_by=request.user,
        )

        return Response(
            {
                "status": "success",
                "results": results,
                "document": DocumentSerializer(doc).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """
        Cancel a Document and release all reservations.
        POST /api/documents/{id}/cancel/
        """
        doc = self.get_object()
        doc.cancel(created_by=request.user)

        return Response(
            {
                "status": "canceled",
                "document": DocumentSerializer(doc).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"])
    def picking_list(self, request, pk=None):
        """
        Return a picking list for this Document.

        GET /api/documents/{id}/picking_list/

        Response structure:
        {
            "document": { ... },
            "picking_list": [
                {"bin": "A-01", "items": [ {reservation entries...} ] },
                ...
            ]
        }
        """
        doc = self.get_object()

        # Reservations for this document that still have remaining qty to pick
        reservations = (
            Reservation.objects
            .filter(line__document=doc)
            .filter(qty__gt=F('qty_picked'))
            .select_related('quant', 'line__item', 'quant__bin', 'quant__lot')
            .order_by('quant__bin__location_code')
        )

        # Group reservations by bin location for a picker-friendly list
        grouped = {}
        for r in reservations:
            bin_code = getattr(r.quant.bin, 'location_code', str(r.quant.bin))
            entry = {
                'reservation_id': r.id,
                'quant_id': r.quant.id,
                'item_sku': r.line.item.sku,
                'item_name': r.line.item.name,
                'lot_code': r.quant.lot.lot_code if r.quant.lot else None,
                'qty': r.qty,
                'qty_picked': r.qty_picked,
                'qty_remaining': r.qty_remaining,
                'bin_location': bin_code,
            }

            grouped.setdefault(bin_code, []).append(entry)

        picking_list = [
            {'bin': bin_code, 'items': items}
            for bin_code, items in grouped.items()
        ]

        return Response(
            {
                'document': DocumentSerializer(doc).data,
                'picking_list': picking_list,
            },
            status=status.HTTP_200_OK,
        )


class DocumentLineViewSet(viewsets.ModelViewSet):
    """ViewSet for DocumentLine."""

    queryset = DocumentLine.objects.all()
    serializer_class = DocumentLineSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["document", "item"]


class ReservationViewSet(viewsets.ModelViewSet):
    """ViewSet for Reservation."""

    queryset = Reservation.objects.all()
    serializer_class = ReservationSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["line", "quant"]

    @action(detail=True, methods=["post"])
    def pick(self, request, pk=None):
        """
        Execute a pick on a Reservation.
        POST /api/reservations/{id}/pick/
        {
            "qty": 50
        }
        """
        reservation = self.get_object()
        serializer = PickReservationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        qty = serializer.data.get("qty")

        try:
            success = reservation.pick(qty=qty, created_by=request.user)
        except ValidationError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not success:
            return Response(
                {"error": "Pick failed: insufficient quantity"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "status": "picked",
                "reservation": ReservationSerializer(reservation).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"])
    def unreserve(self, request, pk=None):
        """
        Release a Reservation.
        POST /api/reservations/{id}/unreserve/
        """
        reservation = self.get_object()
        reservation.unreserve(created_by=request.user)

        return Response(
            {
                "status": "unreserved",
            },
            status=status.HTTP_200_OK,
        )

