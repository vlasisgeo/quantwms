from typing import List

from django.utils.deprecation import MiddlewareMixin

from core.models import Company


class TenantMiddleware(MiddlewareMixin):
    """Resolve tenant (Company) from header `X-Company-Id` or `company_id` query param.

    Also populates `request.assigned_warehouses` with Warehouse objects for
    authenticated users based on `WarehouseAssignment` records.
    """

    def process_request(self, request):
        company = None
        company_id = None

        # Check header first (HTTP_X_COMPANY_ID) then query param
        company_id = request.META.get('HTTP_X_COMPANY_ID') or request.GET.get('company_id')

        if company_id:
            try:
                company = Company.objects.filter(pk=company_id).first()
            except Exception:
                company = None

        request.company = company

        # Populate assigned_warehouses lazily (import models here to avoid app-loading order issues)
        request.assigned_warehouses = []
        if getattr(request, 'user', None) and request.user.is_authenticated:
            try:
                from .models import WarehouseAssignment

                assignments = WarehouseAssignment.objects.filter(user=request.user).select_related('warehouse')
                request.assigned_warehouses = [a.warehouse for a in assignments]
            except Exception:
                request.assigned_warehouses = []

        return None
