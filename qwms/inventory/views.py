"""Views and viewsets for inventory app."""

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.core.exceptions import ValidationError

from inventory.models import (
    ItemCategory,
    Item,
    Lot,
    StockCategory,
    Quant,
    Movement,
)
from inventory.serializers import (
    ItemCategorySerializer,
    ItemSerializer,
    LotSerializer,
    StockCategorySerializer,
    QuantSerializer,
    MovementSerializer,
    ReceiveGoodsSerializer,
    InventorySnapshotSerializer,
    TransferQuantSerializer,
)
from inventory.models import get_inventory_by_item, get_inventory_by_bin


class ItemCategoryViewSet(viewsets.ModelViewSet):
    """ViewSet for ItemCategory."""

    queryset = ItemCategory.objects.all()
    serializer_class = ItemCategorySerializer
    permission_classes = [permissions.IsAuthenticated]


class ItemViewSet(viewsets.ModelViewSet):
    """ViewSet for Item (product/SKU)."""

    queryset = Item.objects.all()
    serializer_class = ItemSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["category", "active"]
    search_fields = ["sku", "name"]


class LotViewSet(viewsets.ModelViewSet):
    """ViewSet for Lot (batch)."""

    queryset = Lot.objects.all()
    serializer_class = LotSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["item"]


class StockCategoryViewSet(viewsets.ModelViewSet):
    """ViewSet for StockCategory."""

    queryset = StockCategory.objects.all()
    serializer_class = StockCategorySerializer
    permission_classes = [permissions.IsAuthenticated]


class QuantViewSet(viewsets.ModelViewSet):
    """ViewSet for Quant (inventory unit)."""

    queryset = Quant.objects.all()
    serializer_class = QuantSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["item", "bin", "owner", "stock_category"]

    @action(detail=False, methods=["post"])
    def receive_goods(self, request):
        """
        Receive goods into inventory.
        POST /api/quants/receive_goods/
        {
            "bin_id": 1,
            "item_sku": "SKU-001",
            "qty": 100,
            "lot_code": "BATCH-001",
            "stock_category": "UNRESTRICTED",
            "owner_id": 1,
            "notes": "Received from supplier"
        }
        """
        serializer = ReceiveGoodsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            bin = get_object_or_404(Quant.objects.model._meta.get_field("bin").related_model, id=serializer.data["bin_id"])
        except:
            return Response(
                {"error": "Bin not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            item = get_object_or_404(Item, sku=serializer.data["item_sku"])
        except:
            return Response(
                {"error": "Item not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            owner = get_object_or_404(Quant.objects.model._meta.get_field("owner").related_model, id=serializer.data["owner_id"])
        except:
            return Response(
                {"error": "Owner (Company) not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        stock_category_code = serializer.data.get("stock_category", "UNRESTRICTED")
        try:
            stock_category = StockCategory.objects.get(code=stock_category_code)
        except StockCategory.DoesNotExist:
            return Response(
                {"error": f"Stock category '{stock_category_code}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        lot = None
        if serializer.data.get("lot_code"):
            lot, created = Lot.objects.get_or_create(
                item=item,
                lot_code=serializer.data["lot_code"],
            )

        # Get or create quant
        quant, created = Quant.objects.get_or_create(
            item=item,
            bin=bin,
            lot=lot,
            stock_category=stock_category,
            owner=owner,
        )

        # Receive the goods
        try:
            quant.receive_qty(
                qty=serializer.data["qty"],
                created_by=request.user,
            )
        except ValidationError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            QuantSerializer(quant).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["get"])
    def by_item(self, request):
        """Get inventory snapshot for an item.
        GET /api/quants/by_item/?item_id=1&warehouse_id=1
        """
        item_id = request.query_params.get("item_id")
        warehouse_id = request.query_params.get("warehouse_id")

        if not item_id:
            return Response(
                {"error": "item_id query param required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            item = Item.objects.get(id=item_id)
        except Item.DoesNotExist:
            return Response(
                {"error": "Item not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        warehouse = None
        if warehouse_id:
            from core.models import Warehouse

            try:
                warehouse = Warehouse.objects.get(id=warehouse_id)
            except Warehouse.DoesNotExist:
                return Response(
                    {"error": "Warehouse not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        inventory_data = get_inventory_by_item(item, warehouse=warehouse)
        return Response(inventory_data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"])
    def transfer(self, request):
        """Transfer quantity between bins.
        POST /api/quants/transfer/
        {
            "from_quant_id": 1,
            "to_quant_id": 2,
            "qty": 50,
            "notes": "Transfer to better location"
        }
        """
        serializer = TransferQuantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            from_quant = Quant.objects.get(id=serializer.data["from_quant_id"])
        except Quant.DoesNotExist:
            return Response(
                {"error": "Source quant not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            to_quant = Quant.objects.get(id=serializer.data["to_quant_id"])
        except Quant.DoesNotExist:
            return Response(
                {"error": "Destination quant not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            success = from_quant.transfer_qty(
                target_quant=to_quant,
                qty=serializer.data["qty"],
                created_by=request.user,
            )
        except ValidationError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not success:
            return Response(
                {"error": "Transfer failed: insufficient available quantity"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "status": "success",
                "from_quant": QuantSerializer(from_quant).data,
                "to_quant": QuantSerializer(to_quant).data,
            },
            status=status.HTTP_200_OK,
        )


class MovementViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Movement (audit log, read-only)."""

    queryset = Movement.objects.all()
    serializer_class = MovementSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["item", "warehouse", "movement_type"]
    ordering = ["-created_at"]


def get_inventory_by_bin_view(bin):
    """Helper function for bin inventory endpoint."""
    return get_inventory_by_bin(bin)

