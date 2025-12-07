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
