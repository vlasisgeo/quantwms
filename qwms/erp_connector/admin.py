from django.contrib import admin

from .models import ERPIntegration, InboundEvent, Delivery


@admin.register(ERPIntegration)
class ERPIntegrationAdmin(admin.ModelAdmin):
    list_display = ('name', 'company', 'outbound_base_url', 'last_synced_at', 'created_at')
    search_fields = ('name', 'company__name')
    raw_id_fields = ('default_warehouse',)


@admin.register(InboundEvent)
class InboundEventAdmin(admin.ModelAdmin):
    list_display = ('event_type', 'event_id', 'integration', 'received_at', 'processed', 'attempts')
    list_filter = ('processed', 'event_type')
    search_fields = ('event_id', 'event_type')
    readonly_fields = ('payload', 'received_at')


@admin.register(Delivery)
class DeliveryAdmin(admin.ModelAdmin):
    list_display = ('event_type', 'integration', 'status', 'attempts', 'created_at', 'sent_at')
    list_filter = ('status', 'event_type')
    search_fields = ('event_type',)
    readonly_fields = ('payload', 'created_at', 'sent_at')
