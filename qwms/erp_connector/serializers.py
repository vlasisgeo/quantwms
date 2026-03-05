from rest_framework import serializers
from .models import ERPIntegration, InboundEvent, Delivery


class ERPIntegrationSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source='company.name', read_only=True)
    default_warehouse_code = serializers.CharField(
        source='default_warehouse.code', read_only=True, allow_null=True
    )

    class Meta:
        model = ERPIntegration
        fields = [
            'id',
            'name',
            'description',
            'company',
            'company_name',
            'inbound_secret',
            'outbound_base_url',
            'outbound_auth_token',
            'default_warehouse',
            'default_warehouse_code',
            'last_synced_at',
            'created_at',
        ]
        extra_kwargs = {
            'inbound_secret': {'write_only': True},
            'outbound_auth_token': {'write_only': True},
        }


class InboundEventSerializer(serializers.ModelSerializer):
    integration_name = serializers.CharField(source='integration.name', read_only=True)
    # Used when accepting raw webhook data
    event_id = serializers.CharField(required=False, allow_null=True)
    event_type = serializers.CharField()
    data = serializers.JSONField(required=False, default=dict)

    class Meta:
        model = InboundEvent
        fields = [
            'id',
            'integration',
            'integration_name',
            'event_id',
            'event_type',
            'payload',
            'data',
            'received_at',
            'processed',
            'attempts',
            'last_error',
        ]
        read_only_fields = ['id', 'payload', 'received_at', 'processed', 'attempts', 'last_error']


class DeliverySerializer(serializers.ModelSerializer):
    integration_name = serializers.CharField(source='integration.name', read_only=True)

    class Meta:
        model = Delivery
        fields = [
            'id',
            'integration',
            'integration_name',
            'event_type',
            'payload',
            'status',
            'attempts',
            'created_at',
            'sent_at',
            'last_error',
        ]
        read_only_fields = ['id', 'status', 'attempts', 'sent_at', 'last_error', 'created_at']
