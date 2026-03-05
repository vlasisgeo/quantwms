"""Views and viewsets for orders app."""

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F

from orders.models import Document, DocumentLine, Reservation, FulfilmentLog
from orders.serializers import (
    DocumentSerializer,
    DocumentLineSerializer,
    ReservationSerializer,
    CreateDocumentSerializer,
    AddDocumentLineSerializer,
    ReserveDocumentSerializer,
    PickReservationSerializer,
    FulfilmentOrderSerializer,
    FulfilmentLogSerializer,
)
from orders.utils import fire_webhooks
from inventory.models import Item
from core.models import Warehouse, Company


def _scoped_document_qs(user):
    """Return a Document queryset scoped to the user's accessible warehouses/companies."""
    qs = Document.objects.select_related(
        "warehouse", "warehouse_to", "owner", "created_by"
    ).prefetch_related("lines__item")

    if user.is_staff:
        return qs

    from core.models import get_user_warehouses, get_user_companies

    warehouses = get_user_warehouses(user)
    companies = get_user_companies(user)

    if warehouses.exists() and companies.exists():
        return qs.filter(warehouse__in=warehouses, owner__in=companies).distinct()
    if warehouses.exists():
        return qs.filter(warehouse__in=warehouses).distinct()
    if companies.exists():
        return qs.filter(owner__in=companies).distinct()

    return qs.none()


class DocumentViewSet(viewsets.ModelViewSet):
    """ViewSet for Document (order/transfer/receipt)."""

    queryset = Document.objects.select_related("warehouse", "warehouse_to", "owner", "created_by")
    serializer_class = DocumentSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["warehouse", "owner", "status", "doc_type"]
    search_fields = ["doc_number", "erp_doc_number"]
    ordering_fields = ["created_at", "doc_number", "status", "doc_type"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return _scoped_document_qs(self.request.user)

    def create(self, request, *args, **kwargs):
        """
        Create a new Document via standard REST endpoint.
        POST /api/documents/
        {
            "doc_number": "SO-001",
            "doc_type": 100,
            "warehouse_id": 1,
            "owner_id": 1,
            "erp_doc_number": "ERP-001",
            "notes": "Customer order"
        }
        """
        return self._build_document(request)

    @action(detail=False, methods=["post"])
    def create_document(self, request):
        """Alias for POST /api/documents/ — kept for backwards compatibility."""
        return self._build_document(request)

    def _build_document(self, request):
        serializer = CreateDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            warehouse = Warehouse.objects.get(id=serializer.data["warehouse_id"])
        except Warehouse.DoesNotExist:
            return Response({"error": "Warehouse not found"}, status=status.HTTP_404_NOT_FOUND)

        warehouse_to = None
        if serializer.data.get("warehouse_to_id"):
            try:
                warehouse_to = Warehouse.objects.get(id=serializer.data["warehouse_to_id"])
            except Warehouse.DoesNotExist:
                return Response({"error": "Destination warehouse not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            owner = Company.objects.get(id=serializer.data["owner_id"])
        except Company.DoesNotExist:
            return Response({"error": "Owner (Company) not found"}, status=status.HTTP_404_NOT_FOUND)

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

        return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def fulfil(self, request):
        """
        Create a fulfilment order with all lines in one atomic call.
        Optionally auto-reserve stock immediately.

        POST /api/documents/fulfil/
        {
            "doc_number": "SO-00123",
            "warehouse_id": 1,
            "owner_id": 1,
            "erp_doc_number": "SHOPIFY-9981",
            "notes": "Next day delivery",
            "reserve": true,
            "strategy": "FIFO",
            "lines": [
                {"item_sku": "SKU-001", "qty_requested": 3, "price": "19.99"},
                {"item_sku": "SKU-002", "qty_requested": 1, "price": "49.99"}
            ]
        }

        Every attempt — success or failure — is recorded in FulfilmentLog.
        Active CompanyWebhook entries receive an HTTP POST with event type:
          fulfil.success  — all lines fully allocated
          fulfil.partial  — some lines could not be allocated
          fulfil.failed   — document/reservation raised an error
        """
        serializer = FulfilmentOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # --- resolve warehouse / owner before touching the log ---
        try:
            warehouse = Warehouse.objects.get(id=data["warehouse_id"])
        except Warehouse.DoesNotExist:
            return Response({"error": "Warehouse not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            owner = Company.objects.get(id=data["owner_id"])
        except Company.DoesNotExist:
            return Response({"error": "Owner (Company) not found"}, status=status.HTTP_404_NOT_FOUND)

        # --- create the audit log entry (PENDING) ---
        log = FulfilmentLog.objects.create(
            doc_number=data["doc_number"],
            owner=owner,
            status=FulfilmentLog.LogStatus.PENDING,
            requested_by=request.user,
        )

        # --- resolve all items upfront so we fail fast before touching the DB ---
        resolved_lines = []
        for line_data in data["lines"]:
            try:
                item = Item.objects.get(sku=line_data["item_sku"])
            except Item.DoesNotExist:
                error_msg = f"Item not found: {line_data['item_sku']}"
                log.status = FulfilmentLog.LogStatus.FAILED
                log.error_message = error_msg
                log.save()
                fire_webhooks(owner, "fulfil.failed", {
                    "event": "fulfil.failed",
                    "doc_number": data["doc_number"],
                    "error": error_msg,
                    "log_id": log.id,
                })
                return Response({"error": error_msg}, status=status.HTTP_404_NOT_FOUND)
            resolved_lines.append((item, line_data))

        # --- atomic document + line creation ---
        try:
            with transaction.atomic():
                doc = Document.objects.create(
                    doc_number=data["doc_number"],
                    doc_type=Document.DocType.OUTBOUND_ORDER,
                    warehouse=warehouse,
                    owner=owner,
                    erp_doc_number=data.get("erp_doc_number", ""),
                    notes=data.get("notes", ""),
                    created_by=request.user,
                )

                for item, line_data in resolved_lines:
                    DocumentLine.objects.create(
                        document=doc,
                        item=item,
                        qty_requested=line_data["qty_requested"],
                        price=line_data.get("price"),
                        discount_percent=line_data.get("discount_percent", 0),
                        notes=line_data.get("notes", ""),
                    )

                allocation_results = None
                if data.get("reserve"):
                    allocation_results = doc.reserve_all_lines(
                        strategy=data.get("strategy", "FIFO"),
                        created_by=request.user,
                    )

        except Exception as exc:
            error_msg = str(exc)
            log.status = FulfilmentLog.LogStatus.FAILED
            log.error_message = error_msg
            log.save()
            fire_webhooks(owner, "fulfil.failed", {
                "event": "fulfil.failed",
                "doc_number": data["doc_number"],
                "error": error_msg,
                "log_id": log.id,
            })
            return Response({"error": error_msg}, status=status.HTTP_400_BAD_REQUEST)

        # --- determine overall allocation status ---
        if allocation_results is not None:
            unallocated = allocation_results.get("unallocated_lines", [])
            partial = allocation_results.get("partially_allocated_lines", [])
            if unallocated or partial:
                log_status = FulfilmentLog.LogStatus.PARTIAL
                event_type = "fulfil.partial"
            else:
                log_status = FulfilmentLog.LogStatus.SUCCESS
                event_type = "fulfil.success"
        else:
            # reserve=false — document created, no allocation attempted
            log_status = FulfilmentLog.LogStatus.SUCCESS
            event_type = "fulfil.success"

        log.document = doc
        log.status = log_status
        log.allocation_results = allocation_results
        log.save()

        webhook_payload = {
            "event": event_type,
            "doc_number": doc.doc_number,
            "erp_doc_number": doc.erp_doc_number,
            "log_id": log.id,
            "allocation": allocation_results,
        }
        fire_webhooks(owner, event_type, webhook_payload)

        response_data = {
            "document": DocumentSerializer(doc).data,
            "log_id": log.id,
        }
        if allocation_results is not None:
            response_data["allocation"] = allocation_results

        return Response(response_data, status=status.HTTP_201_CREATED)

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

        if doc.status in (Document.Status.COMPLETED, Document.Status.CANCELED):
            return Response(
                {"error": f"Cannot add lines to a {doc.get_status_display()} document"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AddDocumentLineSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            item = Item.objects.get(sku=serializer.data["item_sku"])
        except Item.DoesNotExist:
            return Response({"error": "Item not found"}, status=status.HTTP_404_NOT_FOUND)

        line = DocumentLine.objects.create(
            document=doc,
            item=item,
            qty_requested=serializer.data["qty_requested"],
            price=serializer.data.get("price"),
            discount_percent=serializer.data.get("discount_percent", 0),
            notes=serializer.data.get("notes", ""),
        )

        return Response(DocumentLineSerializer(line).data, status=status.HTTP_201_CREATED)

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

        if doc.status == Document.Status.CANCELED:
            return Response({"error": "Cannot reserve a canceled document"}, status=status.HTTP_400_BAD_REQUEST)
        if doc.status == Document.Status.COMPLETED:
            return Response({"error": "Document is already completed"}, status=status.HTTP_400_BAD_REQUEST)

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

        if doc.status == Document.Status.CANCELED:
            return Response({"error": "Document is already canceled"}, status=status.HTTP_400_BAD_REQUEST)
        if doc.status == Document.Status.COMPLETED:
            return Response({"error": "Cannot cancel a completed document"}, status=status.HTTP_400_BAD_REQUEST)

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
        """
        doc = self.get_object()

        reservations = (
            Reservation.objects
            .filter(line__document=doc)
            .filter(qty__gt=F("qty_picked"))
            .select_related("quant__bin", "quant__lot", "line__item")
            .order_by("quant__bin__location_code")
        )

        grouped = {}
        for r in reservations:
            bin_code = r.quant.bin.location_code
            entry = {
                "reservation_id": r.id,
                "quant_id": r.quant.id,
                "item_sku": r.line.item.sku,
                "item_name": r.line.item.name,
                "lot_code": r.quant.lot.lot_code if r.quant.lot else None,
                "qty": r.qty,
                "qty_picked": r.qty_picked,
                "qty_remaining": r.qty_remaining,
                "bin_location": bin_code,
            }
            grouped.setdefault(bin_code, []).append(entry)

        picking_list = [{"bin": bin_code, "items": items} for bin_code, items in grouped.items()]

        return Response(
            {
                "document": DocumentSerializer(doc).data,
                "picking_list": picking_list,
            },
            status=status.HTTP_200_OK,
        )


class DocumentLineViewSet(viewsets.ModelViewSet):
    """ViewSet for DocumentLine."""

    queryset = DocumentLine.objects.select_related("document__warehouse", "document__owner", "item")
    serializer_class = DocumentLineSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["document", "item"]
    ordering_fields = ["id", "qty_requested", "qty_allocated", "qty_picked"]

    def get_queryset(self):
        user = self.request.user
        qs = DocumentLine.objects.select_related("document__warehouse", "document__owner", "item")

        if user.is_staff:
            return qs

        from core.models import get_user_warehouses, get_user_companies

        warehouses = get_user_warehouses(user)
        companies = get_user_companies(user)

        if warehouses.exists() and companies.exists():
            return qs.filter(
                document__warehouse__in=warehouses, document__owner__in=companies
            ).distinct()
        if warehouses.exists():
            return qs.filter(document__warehouse__in=warehouses).distinct()
        if companies.exists():
            return qs.filter(document__owner__in=companies).distinct()

        return qs.none()


class ReservationViewSet(viewsets.ModelViewSet):
    """ViewSet for Reservation."""

    queryset = Reservation.objects.select_related(
        "line__document__warehouse", "line__document__owner",
        "line__item", "quant__bin", "quant__item", "quant__lot",
    )
    serializer_class = ReservationSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["line", "quant"]
    ordering_fields = ["id", "qty", "qty_picked"]

    def get_queryset(self):
        user = self.request.user
        qs = Reservation.objects.select_related(
            "line__document__warehouse", "line__document__owner",
            "line__item", "quant__bin", "quant__item", "quant__lot",
        )

        if user.is_staff:
            return qs

        from core.models import get_user_warehouses, get_user_companies

        warehouses = get_user_warehouses(user)
        companies = get_user_companies(user)

        if warehouses.exists() and companies.exists():
            return qs.filter(
                line__document__warehouse__in=warehouses,
                line__document__owner__in=companies,
            ).distinct()
        if warehouses.exists():
            return qs.filter(line__document__warehouse__in=warehouses).distinct()
        if companies.exists():
            return qs.filter(line__document__owner__in=companies).distinct()

        return qs.none()

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
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

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

        return Response({"status": "unreserved"}, status=status.HTTP_200_OK)


class FulfilmentLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only viewset for FulfilmentLog entries.

    Warehouse staff (is_staff) see all logs.
    Company members see only logs for their companies.
    """

    queryset = FulfilmentLog.objects.select_related("document", "owner", "requested_by")
    serializer_class = FulfilmentLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["owner", "status", "document"]
    search_fields = ["doc_number"]
    ordering_fields = ["created_at", "status"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        qs = FulfilmentLog.objects.select_related("document", "owner", "requested_by")

        if user.is_staff:
            return qs

        from core.models import get_user_companies

        companies = get_user_companies(user)
        return qs.filter(owner__in=companies).distinct()
