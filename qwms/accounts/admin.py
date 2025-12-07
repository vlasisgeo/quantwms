from django.contrib import admin

from .models import Membership, WarehouseAssignment


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ('user', 'company', 'role', 'created_at')
    search_fields = ('user__username', 'company__name')


@admin.register(WarehouseAssignment)
class WarehouseAssignmentAdmin(admin.ModelAdmin):
    list_display = ('user', 'warehouse', 'can_manage', 'created_at')
    search_fields = ('user__username', 'warehouse__name')
