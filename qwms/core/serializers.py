"""Serializers for core app (Company, Warehouse, Section, Bin, WarehouseUser)."""

from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from django.conf import settings
from core.models import Company, Warehouse, Section, BinType, Bin

# When the legacy WarehouseUser compatibility layer is disabled we expose a
# read-only accounts-backed representation via `UserAccessEntrySerializer`.


class CompanySerializer(serializers.ModelSerializer):
    """Serialize Company model."""

    class Meta:
        model = Company
        fields = ["id", "code", "name", "vat_no", "address", "active", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class WarehouseSerializer(serializers.ModelSerializer):
    """Serialize Warehouse model."""

    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = Warehouse
        fields = [
            "id",
            "code",
            "name",
            "company",
            "company_name",
            "address",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class SectionSerializer(serializers.ModelSerializer):
    """Serialize Section model."""

    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)

    class Meta:
        model = Section
        fields = [
            "id",
            "warehouse",
            "warehouse_code",
            "code",
            "name",
            "description",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class BinTypeSerializer(serializers.ModelSerializer):
    """Serialize BinType model."""

    class Meta:
        model = BinType
        fields = [
            "id",
            "name",
            "description",
            "x_mm",
            "y_mm",
            "z_mm",
            "max_weight_grams",
            "static",
            "active",
        ]


class BinSerializer(serializers.ModelSerializer):
    """Serialize Bin model with nested labels."""

    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)
    section_code = serializers.CharField(source="section.code", read_only=True)
    bin_type_name = serializers.CharField(source="bin_type.name", read_only=True)
    label = serializers.SerializerMethodField()

    class Meta:
        model = Bin
        fields = [
            "id",
            "code",
            "warehouse",
            "warehouse_code",
            "section",
            "section_code",
            "location_code",
            "bin_type",
            "bin_type_name",
            "active",
            "note",
            "label",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["code", "created_at", "updated_at"]

    @extend_schema_field(serializers.DictField)
    def get_label(self, obj):
        """Return the bin label."""
        return obj.label


class LocationCreateSerializer(serializers.Serializer):
    """Serializer for creating a single location (Bin)."""

    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.all())
    section = serializers.PrimaryKeyRelatedField(queryset=Section.objects.all())
    location_code = serializers.CharField(max_length=100)
    bin_type = serializers.PrimaryKeyRelatedField(queryset=BinType.objects.all(), allow_null=True, required=False)
    note = serializers.CharField(allow_blank=True, required=False)

    def validate(self, data):
        # Ensure section belongs to warehouse
        section = data.get('section')
        warehouse = data.get('warehouse')
        if section.warehouse_id != warehouse.id:
            raise serializers.ValidationError('Section does not belong to the specified warehouse')
        return data


class DexionMassCreateSerializer(serializers.Serializer):
    """Serializer for mass-creating Dexion-style locations.

    Example params:
      aisle_from, aisle_to: integers
      bay_from, bay_to: integers
      level_from, level_to: integers
      format: string using tokens {aisle},{bay},{level} (default: "A{aisle}-B{bay}-L{level}")
      pad_aisle/bay/level: integer zero-padding width
    """

    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.all())
    section = serializers.PrimaryKeyRelatedField(queryset=Section.objects.all())
    aisle_from = serializers.IntegerField(min_value=0, default=1)
    aisle_to = serializers.IntegerField(min_value=0, default=1)
    bay_from = serializers.IntegerField(min_value=0, default=1)
    bay_to = serializers.IntegerField(min_value=0, default=1)
    level_from = serializers.IntegerField(min_value=0, default=1)
    level_to = serializers.IntegerField(min_value=0, default=1)
    format = serializers.CharField(default='A{aisle}-B{bay}-L{level}')
    pad_aisle = serializers.IntegerField(min_value=0, default=0)
    pad_bay = serializers.IntegerField(min_value=0, default=2)
    pad_level = serializers.IntegerField(min_value=0, default=2)

    def validate(self, data):
        section = data.get('section')
        warehouse = data.get('warehouse')
        if section.warehouse_id != warehouse.id:
            raise serializers.ValidationError('Section does not belong to the specified warehouse')
        if data['aisle_to'] < data['aisle_from'] or data['bay_to'] < data['bay_from'] or data['level_to'] < data['level_from']:
            raise serializers.ValidationError('Range end must be >= range start')
        return data


class UserAccessEntrySerializer(serializers.Serializer):
    """Read-only serializer that represents a user's access entry.

    This is used by the admin access endpoint. Fields mirror the former
    `WarehouseUser` shape for backwards compatibility but are sourced from
    `accounts` models (Membership, WarehouseAssignment).
    """

    id = serializers.IntegerField(read_only=True)
    user = serializers.IntegerField(read_only=True)
    user_username = serializers.CharField(read_only=True)
    company = serializers.IntegerField(allow_null=True, read_only=True)
    company_name = serializers.CharField(allow_null=True, read_only=True)
    warehouse = serializers.IntegerField(allow_null=True, read_only=True)
    warehouse_name = serializers.CharField(allow_null=True, read_only=True)
    role = serializers.IntegerField(read_only=True)
    active = serializers.BooleanField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
