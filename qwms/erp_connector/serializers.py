from rest_framework import serializers

class InboundEventSerializer(serializers.Serializer):
    event_id = serializers.CharField(required=False, allow_null=True)
    event_type = serializers.CharField()
    data = serializers.JSONField()
