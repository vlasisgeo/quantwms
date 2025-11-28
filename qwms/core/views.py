"""Views/Viewsets for core app."""

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db import models

from core.models import Company, Warehouse, Section, BinType, Bin, WarehouseUser
from core.serializers import (
    CompanySerializer,
    WarehouseSerializer,
    SectionSerializer,
    BinTypeSerializer,
    BinSerializer,
    WarehouseUserSerializer,
)


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
        # Non-staff users only see companies they have access to
        return Company.objects.filter(warehouse__warehouseuser__user=user).distinct()


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
        return Warehouse.objects.filter(warehouseuser__user=user).distinct()


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
    """ViewSet for WarehouseUser (user permissions)."""

    queryset = WarehouseUser.objects.all()
    serializer_class = WarehouseUserSerializer
    permission_classes = [permissions.IsAuthenticated, permissions.IsAdminUser]
    filterset_fields = ["user", "warehouse", "company", "active"]

    @action(detail=False, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def my_access(self, request):
        """
        GET /api/warehouse-users/my_access/
        
        Return the current user's effective access: companies, warehouses, and quants they can see.
        """
        from core.models import get_user_companies, get_user_warehouses
        from inventory.models import Quant

        user = request.user
        
        # Get user's effective access
        companies = get_user_companies(user)
        warehouses = get_user_warehouses(user)
        
        # Get quants visible to the user using the same logic as QuantViewSet
        if user.is_staff:
            visible_quants = Quant.objects.all()
        else:
            # Intersection semantics: if both companies and warehouses exist, use intersection
            if companies.exists() and warehouses.exists():
                visible_quants = Quant.objects.filter(bin__warehouse__in=warehouses, owner__in=companies)
            elif warehouses.exists():
                visible_quants = Quant.objects.filter(bin__warehouse__in=warehouses)
            elif companies.exists():
                visible_quants = Quant.objects.filter(owner__in=companies)
            else:
                visible_quants = Quant.objects.none()
        
        visible_quants = visible_quants.distinct()
        
        return Response(
            {
                "user": user.username,
                "is_staff": user.is_staff,
                "companies": [
                    {"id": c.id, "code": c.code, "name": c.name}
                    for c in companies
                ],
                "warehouses": [
                    {"id": w.id, "code": w.code, "name": w.name}
                    for w in warehouses
                ],
                "visible_quants_count": visible_quants.count(),
            },
            status=status.HTTP_200_OK,
        )

