"""Serializers for inventory app (Item, Lot, Quant, Movement, etc.)."""

from rest_framework import serializers
from inventory.models import (
    ItemCategory,
    Item,
    Lot,
    StockCategory,
    Quant,
    Movement,
)


class ItemCategorySerializer(serializers.ModelSerializer):
    """Serialize ItemCategory."""

    class Meta:
        model = ItemCategory
        fields = ["id", "name", "description", "active", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class ItemSerializer(serializers.ModelSerializer):
    """Serialize Item (product/SKU)."""

    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = Item
        fields = [
            "id",
            "sku",
            "name",
            "description",
            "category",
            "category_name",
            "length_mm",
            "width_mm",
            "height_mm",
            "weight_grams",
            "fragile",
            "hazardous",
            "requires_refrigeration",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class LotSerializer(serializers.ModelSerializer):
    """Serialize Lot (batch with expiry)."""

    item_sku = serializers.CharField(source="item.sku", read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    days_to_expiry = serializers.IntegerField(read_only=True)

    class Meta:
        model = Lot
        fields = [
            "id",
            "item",
            "item_sku",
            "lot_code",
            "expiry_date",
            "manufacture_date",
            "notes",
            "is_expired",
            "days_to_expiry",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class StockCategorySerializer(serializers.ModelSerializer):
    """Serialize StockCategory."""

    class Meta:
        model = StockCategory
        fields = ["code", "name", "description"]


class QuantSerializer(serializers.ModelSerializer):
    """Serialize Quant (inventory unit)."""

    item_sku = serializers.CharField(source="item.sku", read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    bin_location = serializers.CharField(source="bin.location_code", read_only=True)
    lot_code = serializers.CharField(source="lot.lot_code", read_only=True, allow_null=True)
    warehouse_code = serializers.CharField(source="bin.warehouse.code", read_only=True)
    owner_name = serializers.CharField(source="owner.name", read_only=True)
    qty_available = serializers.IntegerField(read_only=True)

    class Meta:
        model = Quant
        fields = [
            "id",
            "item",
            "item_sku",
            "item_name",
            "bin",
            "bin_location",
            "warehouse_code",
            "lot",
            "lot_code",
            "stock_category",
            "is_temp_unrefrigerated",
            "owner",
            "owner_name",
            "qty",
            "qty_reserved",
            "qty_available",
            "received_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["qty_available", "created_at", "updated_at"]


class MovementSerializer(serializers.ModelSerializer):
    """Serialize Movement (audit log)."""

    item_sku = serializers.CharField(source="item.sku", read_only=True)
    from_quant_id = serializers.IntegerField(source="from_quant.id", read_only=True, allow_null=True)
    to_quant_id = serializers.IntegerField(source="to_quant.id", read_only=True, allow_null=True)
    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True, allow_null=True)

    class Meta:
        model = Movement
        fields = [
            "id",
            "item",
            "item_sku",
            "from_quant",
            "from_quant_id",
            "to_quant",
            "to_quant_id",
            "qty",
            "movement_type",
            "warehouse",
            "warehouse_code",
            "reference",
            "notes",
            "created_by",
            "created_by_username",
            "created_at",
        ]
        read_only_fields = [
            "item",
            "from_quant",
            "to_quant",
            "qty",
            "movement_type",
            "warehouse",
            "created_by",
            "created_at",
        ]


class ReceiveGoodsSerializer(serializers.Serializer):
    """Serializer for receiving goods (create/add to Quant)."""

    bin_id = serializers.IntegerField()
    item_sku = serializers.CharField()
    qty = serializers.IntegerField(min_value=1)
    lot_code = serializers.CharField(required=False, allow_blank=True)
    stock_category = serializers.CharField(default="UNRESTRICTED")
    owner_id = serializers.IntegerField()
    notes = serializers.CharField(required=False, allow_blank=True)


class InventorySnapshotSerializer(serializers.Serializer):
    """Serializer for inventory snapshot (query results)."""

    item_sku = serializers.CharField()
    total_qty = serializers.IntegerField()
    total_reserved = serializers.IntegerField()
    total_available = serializers.IntegerField()
    by_bin = serializers.ListField()


class TransferQuantSerializer(serializers.Serializer):
    """Serializer for transferring quantity between bins."""

    from_quant_id = serializers.IntegerField()
    to_quant_id = serializers.IntegerField()
    qty = serializers.IntegerField(min_value=1)
    notes = serializers.CharField(required=False, allow_blank=True)
