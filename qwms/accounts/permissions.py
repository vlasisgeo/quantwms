from rest_framework import permissions


class IsCompanyMemberOrWarehouseStaff(permissions.BasePermission):
    """Allow access when user is a member of the resolved `request.company` or
    is assigned to one of the requested warehouses.

    This is a conservative, application-level permission helper. Views should
    still implement object-level checks where appropriate.
    """

    def has_permission(self, request, view):
        company = getattr(request, 'company', None)

        # If a company is resolved and user is authenticated, check membership
        if company and request.user and request.user.is_authenticated:
            # membership check
            try:
                if request.user.memberships.filter(company=company).exists():
                    return True
            except Exception:
                pass

        # Allow staff that have warehouse assignments (view-level code should
        # filter by warehouses). This is permissive; object checks will constrain.
        if getattr(request, 'assigned_warehouses', None):
            return True

        return False

    def has_object_permission(self, request, view, obj):
        # Quick checks for common model shapes
        if hasattr(obj, 'owner'):
            if obj.owner == getattr(request, 'company', None):
                return True

        if hasattr(obj, 'bin') and hasattr(obj.bin, 'warehouse'):
            if obj.bin.warehouse in getattr(request, 'assigned_warehouses', []):
                return True

        return False
