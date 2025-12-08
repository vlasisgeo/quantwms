from django.contrib import admin

from .models import ERPIntegration, InboundEvent


@admin.register(ERPIntegration)
class ERPIntegrationAdmin(admin.ModelAdmin):
    list_display = ('name', 'company', 'outbound_base_url', 'created_at')
    search_fields = ('name', 'company__name')


@admin.register(InboundEvent)
class InboundEventAdmin(admin.ModelAdmin):
    list_display = ('event_type', 'event_id', 'integration', 'received_at', 'processed')
    search_fields = ('event_id', 'event_type')
    readonly_fields = ('payload', 'received_at')
