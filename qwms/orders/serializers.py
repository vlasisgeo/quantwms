"""Serializers for orders app (Document, DocumentLine, Reservation)."""

from rest_framework import serializers
from orders.models import Document, DocumentLine, Reservation


class DocumentLineSerializer(serializers.ModelSerializer):
    """Serialize DocumentLine."""

    item_sku = serializers.CharField(source="item.sku", read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    qty_remaining = serializers.IntegerField(read_only=True)

    class Meta:
        model = DocumentLine
        fields = [
            "id",
            "document",
            "item",
            "item_sku",
            "item_name",
            "qty_requested",
            "qty_allocated",
            "qty_picked",
            "qty_remaining",
            "price",
            "discount_percent",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["qty_remaining", "created_at", "updated_at"]


class DocumentSerializer(serializers.ModelSerializer):
    """Serialize Document with nested lines."""

    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)
    warehouse_to_code = serializers.CharField(source="warehouse_to.code", read_only=True, allow_null=True)
    owner_name = serializers.CharField(source="owner.name", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True, allow_null=True)
    total_qty_requested = serializers.IntegerField(read_only=True)
    total_qty_allocated = serializers.IntegerField(read_only=True)
    total_qty_picked = serializers.IntegerField(read_only=True)
    qty_remaining = serializers.IntegerField(read_only=True)
    is_completed = serializers.BooleanField(read_only=True)
    lines = DocumentLineSerializer(many=True, read_only=True)

    class Meta:
        model = Document
        fields = [
            "id",
            "doc_number",
            "doc_type",
            "status",
            "warehouse",
            "warehouse_code",
            "warehouse_to",
            "warehouse_to_code",
            "company",
            "owner",
            "owner_name",
            "erp_doc_number",
            "notes",
            "total_qty_requested",
            "total_qty_allocated",
            "total_qty_picked",
            "qty_remaining",
            "is_completed",
            "created_by",
            "created_by_username",
            "lines",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "doc_number",
            "total_qty_requested",
            "total_qty_allocated",
            "total_qty_picked",
            "qty_remaining",
            "is_completed",
            "created_at",
            "updated_at",
        ]


class ReservationSerializer(serializers.ModelSerializer):
    """Serialize Reservation."""

    line_document_number = serializers.CharField(source="line.document.doc_number", read_only=True)
    line_item_sku = serializers.CharField(source="line.item.sku", read_only=True)
    quant_bin_location = serializers.CharField(source="quant.bin.location_code", read_only=True)
    qty_remaining = serializers.IntegerField(read_only=True)

    class Meta:
        model = Reservation
        fields = [
            "id",
            "line",
            "line_document_number",
            "line_item_sku",
            "quant",
            "quant_bin_location",
            "qty",
            "qty_picked",
            "qty_remaining",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["qty_remaining", "created_at", "updated_at"]


class CreateDocumentSerializer(serializers.Serializer):
    """Serializer for creating a new Document."""

    doc_number = serializers.CharField(max_length=100)
    doc_type = serializers.IntegerField()
    warehouse_id = serializers.IntegerField()
    warehouse_to_id = serializers.IntegerField(required=False, allow_null=True)
    owner_id = serializers.IntegerField()
    erp_doc_number = serializers.CharField(max_length=100, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class AddDocumentLineSerializer(serializers.Serializer):
    """Serializer for adding a line to a Document."""

    item_sku = serializers.CharField()
    qty_requested = serializers.IntegerField(min_value=1)
    price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    discount_percent = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, default=0)
    notes = serializers.CharField(required=False, allow_blank=True)


class ReserveDocumentSerializer(serializers.Serializer):
    """Serializer for reserving all lines of a Document."""

    strategy = serializers.ChoiceField(choices=["FIFO", "FEFO"], default="FIFO")


class PickReservationSerializer(serializers.Serializer):
    """Serializer for picking a Reservation."""

    qty = serializers.IntegerField(required=False, allow_null=True)
