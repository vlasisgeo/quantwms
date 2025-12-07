"""Views/Viewsets for core app."""

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db import models

from core.models import Company, Warehouse, Section, BinType, Bin
from core.serializers import (
    CompanySerializer,
    WarehouseSerializer,
    SectionSerializer,
    BinTypeSerializer,
    BinSerializer,
)

from django.conf import settings

# Import serializers conditionally
from core.serializers import UserAccessEntrySerializer as _UserAccessEntrySerializer


class CompanyViewSet(viewsets.ModelViewSet):
    """ViewSet for Company (tenant/customer)."""

    queryset = Company.objects.all()
    serializer_class = CompanySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """Filter companies by user access."""
        user = self.request.user
        if user.is_staff:
            return Company.objects.all()
        # Non-staff users only see companies they have access to (via accounts helpers)
        from core.models import get_user_companies

        return get_user_companies(user)


class WarehouseViewSet(viewsets.ModelViewSet):
    """ViewSet for Warehouse."""

    queryset = Warehouse.objects.all()
    serializer_class = WarehouseSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["company", "active"]

    def get_queryset(self):
        """Filter warehouses by user access."""
        user = self.request.user
        if user.is_staff:
            return Warehouse.objects.all()
        from core.models import get_user_warehouses

        return get_user_warehouses(user).distinct()


class SectionViewSet(viewsets.ModelViewSet):
    """ViewSet for Section."""

    queryset = Section.objects.all()
    serializer_class = SectionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["warehouse", "active"]


class BinTypeViewSet(viewsets.ModelViewSet):
    """ViewSet for BinType."""

    queryset = BinType.objects.all()
    serializer_class = BinTypeSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["active"]


class BinViewSet(viewsets.ModelViewSet):
    """ViewSet for Bin (storage location)."""

    queryset = Bin.objects.all()
    serializer_class = BinSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["warehouse", "section", "active"]

    @action(detail=True, methods=["get"])
    def inventory(self, request, pk=None):
        """Get all inventory in a specific bin."""
        from inventory.views import get_inventory_by_bin_view

        bin = self.get_object()
        inventory_data = get_inventory_by_bin_view(bin)
        return Response(inventory_data)


class WarehouseUserViewSet(viewsets.ModelViewSet):
    """Admin API for user access entries.

    Behavior depends on `settings.USE_LEGACY_WAREHOUSEUSER`:
    - True: original behavior backed by `core.models.WarehouseUser` (read/write).
    - False: read-only proxy backed by `accounts` models (no modifications allowed).
    """

    permission_classes = [permissions.IsAuthenticated, permissions.IsAdminUser]
    # Always operate as a read-only accounts-backed proxy now that legacy model
    # has been removed.
    queryset = Company.objects.none()
    serializer_class = _UserAccessEntrySerializer
    # This is a read-only proxy (not model-backed) so we must not declare
    # `filterset_fields` which would cause django-filter to attempt to build
    # a model FilterSet for non-model fields during schema generation.

    def list(self, request, *args, **kwargs):
        """Return a combined list of access entries from `accounts`.

        This preserves a similar shape to the old `WarehouseUser` serializer but
        is read-only and canonicalizes data from `accounts.Membership` and
        `accounts.WarehouseAssignment`.
        """
        # Build entries from accounts models
        try:
            from accounts.models import Membership, WarehouseAssignment
        except Exception:
            return Response({"error": "accounts app not available"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        entries = []
        # Company-scoped memberships
        for m in Membership.objects.select_related("user", "company").all():
            entries.append(
                {
                    "id": m.id,
                    "user": m.user_id,
                    "user_username": getattr(m.user, "username", ""),
                    "company": m.company_id,
                    "company_name": getattr(m.company, "name", ""),
                    "warehouse": None,
                    "warehouse_name": None,
                    "role": m.role,
                    "active": True,
                    "created_at": m.created_at,
                    "updated_at": m.updated_at,
                }
            )

        # Warehouse-scoped assignments
        for wa in WarehouseAssignment.objects.select_related("user", "warehouse").all():
            entries.append(
                {
                    "id": wa.id + 1000000000,  # synthetic id space to avoid colliding with membership ids
                    "user": wa.user_id,
                    "user_username": getattr(wa.user, "username", ""),
                    "company": wa.warehouse.company_id if wa.warehouse_id else None,
                    "company_name": getattr(getattr(wa.warehouse, "company", None), "name", None),
                    "warehouse": wa.warehouse_id,
                    "warehouse_name": getattr(wa.warehouse, "name", ""),
                    "role": (30 if wa.can_manage else 20),
                    "active": True,
                    "created_at": wa.created_at,
                    "updated_at": wa.updated_at,
                }
            )

        serializer = self.get_serializer(entries, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None, *args, **kwargs):
        # retrieve: find by membership id or synthetic assignment id
        try:
            m = Membership.objects.select_related("user", "company").get(id=pk)
            entry = {
                "id": m.id,
                "user": m.user_id,
                "user_username": getattr(m.user, "username", ""),
                "company": m.company_id,
                "company_name": getattr(m.company, "name", ""),
                "warehouse": None,
                "warehouse_name": None,
                "role": m.role,
                "active": True,
                "created_at": m.created_at,
                "updated_at": m.updated_at,
            }
            serializer = self.get_serializer(entry)
            return Response(serializer.data)
        except Membership.DoesNotExist:
            pass

        try:
            if int(pk) > 1000000000:
                real_id = int(pk) - 1000000000
                wa = WarehouseAssignment.objects.select_related("user", "warehouse").get(id=real_id)
                entry = {
                    "id": int(pk),
                    "user": wa.user_id,
                    "user_username": getattr(wa.user, "username", ""),
                    "company": wa.warehouse.company_id if wa.warehouse_id else None,
                    "company_name": getattr(getattr(wa.warehouse, "company", None), "name", None),
                    "warehouse": wa.warehouse_id,
                    "warehouse_name": getattr(wa.warehouse, "name", ""),
                    "role": (30 if wa.can_manage else 20),
                    "active": True,
                    "created_at": wa.created_at,
                    "updated_at": wa.updated_at,
                }
                serializer = self.get_serializer(entry)
                return Response(serializer.data)
        except WarehouseAssignment.DoesNotExist:
            pass

        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

