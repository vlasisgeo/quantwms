"""Views/Viewsets for core app."""

from django.db import models
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from core.models import Company, Warehouse, Section, BinType, Bin
from core.serializers import (
    CompanySerializer,
    WarehouseSerializer,
    SectionSerializer,
    BinTypeSerializer,
    BinSerializer,
    UserAccessEntrySerializer as _UserAccessEntrySerializer,
)


class CompanyViewSet(viewsets.ModelViewSet):
    """ViewSet for Company (tenant/customer)."""

    queryset = Company.objects.all()
    serializer_class = CompanySerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ["code", "name"]
    ordering_fields = ["name", "code"]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return Company.objects.all()
        from core.models import get_user_companies

        return get_user_companies(user)


class WarehouseViewSet(viewsets.ModelViewSet):
    """ViewSet for Warehouse."""

    queryset = Warehouse.objects.select_related("company")
    serializer_class = WarehouseSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["company", "active"]
    search_fields = ["code", "name"]
    ordering_fields = ["code", "name"]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return Warehouse.objects.select_related("company")
        from core.models import get_user_warehouses

        return get_user_warehouses(user).select_related("company").distinct()


class SectionViewSet(viewsets.ModelViewSet):
    """ViewSet for Section."""

    queryset = Section.objects.select_related("warehouse")
    serializer_class = SectionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["warehouse", "active"]
    search_fields = ["code", "name"]
    ordering_fields = ["code", "name"]


class BinTypeViewSet(viewsets.ModelViewSet):
    """ViewSet for BinType. Writes restricted to admins."""

    queryset = BinType.objects.all()
    serializer_class = BinTypeSerializer
    filterset_fields = ["active"]
    search_fields = ["name"]
    ordering_fields = ["name"]

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]


class BinViewSet(viewsets.ModelViewSet):
    """ViewSet for Bin (storage location)."""

    queryset = Bin.objects.select_related("warehouse", "section", "bin_type").annotate(
        quants_count=models.Count("quants", distinct=True)
    )
    serializer_class = BinSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["warehouse", "section", "active"]
    search_fields = ["location_code"]
    ordering_fields = ["location_code", "warehouse__code", "section__code"]

    @action(detail=True, methods=["get"])
    def inventory(self, request, pk=None):
        """Get all inventory in a specific bin."""
        from inventory.views import get_inventory_by_bin_view

        bin_obj = self.get_object()
        inventory_data = get_inventory_by_bin_view(bin_obj)
        return Response(inventory_data)

    @action(detail=False, methods=["post"], url_path="create-location")
    def create_location(self, request):
        """Create a single Bin (location) and optionally return ZPL label.

        POST body: {warehouse, section, location_code, bin_type?, note?}
        Query param: ?print=1 to return ZPL label for the created bin.
        """
        from core.serializers import LocationCreateSerializer
        serializer = LocationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        existing = Bin.objects.filter(section=data['section'], location_code=data['location_code']).first()
        if existing:
            bin_obj = existing
        else:
            bin_obj = Bin.objects.create(
                warehouse=data['warehouse'],
                section=data['section'],
                location_code=data['location_code'],
                bin_type=data.get('bin_type'),
                note=data.get('note', ''),
            )

        output = BinSerializer(bin_obj, context={'request': request}).data

        if request.query_params.get('print'):
            zpl = self._render_zpl_for_bin(bin_obj)
            return Response(zpl, content_type='text/plain')

        return Response(output)

    @action(detail=False, methods=["post"], url_path="mass-create-dexion")
    def mass_create_dexion(self, request):
        """Mass-create locations using Dexion-style grid parameters.

        Accepts JSON body matching `DexionMassCreateSerializer`.
        Returns list of created or existing bins and (optionally) ZPL bundle if ?print=1.
        """
        from core.serializers import DexionMassCreateSerializer
        mass_ser = DexionMassCreateSerializer(data=request.data)
        mass_ser.is_valid(raise_exception=True)
        params = mass_ser.validated_data

        created = []
        skipped = 0
        for aisle in range(params['aisle_from'], params['aisle_to'] + 1):
            for bay in range(params['bay_from'], params['bay_to'] + 1):
                for level in range(params['level_from'], params['level_to'] + 1):
                    aisle_str = str(aisle).rjust(params['pad_aisle'], '0') if params['pad_aisle'] > 0 else str(aisle)
                    bay_str = str(bay).rjust(params['pad_bay'], '0')
                    level_str = str(level).rjust(params['pad_level'], '0')
                    location_code = params['format'].format(aisle=aisle_str, bay=bay_str, level=level_str)

                    existing = Bin.objects.filter(section=params['section'], location_code=location_code).first()
                    if existing:
                        skipped += 1
                        created.append({'existing': True, 'bin': BinSerializer(existing, context={'request': request}).data})
                        continue

                    b = Bin.objects.create(
                        warehouse=params['warehouse'],
                        section=params['section'],
                        location_code=location_code,
                    )
                    created.append({'existing': False, 'bin': BinSerializer(b, context={'request': request}).data})

        if request.query_params.get('print'):
            zpl_texts = [self._render_zpl_from_serialized(item['bin']) for item in created]
            return Response('\n'.join(zpl_texts), content_type='text/plain')

        return Response({'created': created, 'skipped': skipped})

    def _render_zpl_for_bin(self, bin_obj: Bin) -> str:
        warehouse = getattr(bin_obj.warehouse, 'code', '')
        section = getattr(bin_obj.section, 'code', '')
        location = bin_obj.location_code
        barcode = str(bin_obj.code)

        return (
            '^XA'
            f'^FO50,20^A0N,30,30^FDWH:{warehouse}^FS'
            f'^FO50,60^A0N,30,30^FDSEC:{section}^FS'
            f'^FO50,100^A0N,40,40^FDLOC:{location}^FS'
            f'^FO50,150^BY2^BCN,80,Y,N,N^FD{barcode}^FS'
            '^XZ'
        )

    def _render_zpl_from_serialized(self, bin_data: dict) -> str:
        warehouse = bin_data.get('warehouse_code', '')
        section = bin_data.get('section_code', '')
        location = bin_data.get('location_code', '')
        barcode = bin_data.get('code', '')
        return (
            '^XA'
            f'^FO50,20^A0N,30,30^FDWH:{warehouse}^FS'
            f'^FO50,60^A0N,30,30^FDSEC:{section}^FS'
            f'^FO50,100^A0N,40,40^FDLOC:{location}^FS'
            f'^FO50,150^BY2^BCN,80,Y,N,N^FD{barcode}^FS'
            '^XZ'
        )


class WarehouseUserViewSet(viewsets.ModelViewSet):
    """Admin API for user access entries (read-only proxy backed by accounts models)."""

    permission_classes = [permissions.IsAuthenticated, permissions.IsAdminUser]
    queryset = Company.objects.none()
    serializer_class = _UserAccessEntrySerializer

    def list(self, request, *args, **kwargs):
        """Return a combined list of access entries from `accounts`."""
        try:
            from accounts.models import Membership, WarehouseAssignment
        except Exception:
            return Response({"error": "accounts app not available"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        entries = []
        for m in Membership.objects.select_related("user", "company").all():
            entries.append({
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
                "updated_at": None,
            })

        for wa in WarehouseAssignment.objects.select_related("user", "warehouse").all():
            entries.append({
                "id": wa.id + 1000000000,
                "user": wa.user_id,
                "user_username": getattr(wa.user, "username", ""),
                "company": wa.warehouse.company_id if wa.warehouse_id else None,
                "company_name": getattr(getattr(wa.warehouse, "company", None), "name", None),
                "warehouse": wa.warehouse_id,
                "warehouse_name": getattr(wa.warehouse, "name", ""),
                "role": (30 if wa.can_manage else 20),
                "active": True,
                "created_at": wa.created_at,
                "updated_at": None,
            })

        serializer = self.get_serializer(entries, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None, *args, **kwargs):
        try:
            from accounts.models import Membership, WarehouseAssignment
        except Exception:
            return Response({"error": "accounts app not available"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

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
                "updated_at": None,
            }
            return Response(self.get_serializer(entry).data)
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
                    "updated_at": None,
                }
                return Response(self.get_serializer(entry).data)
        except WarehouseAssignment.DoesNotExist:
            pass

        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
