import hmac
import hashlib
import json

from django.shortcuts import get_object_or_404
from django.utils.encoding import force_bytes
from rest_framework.views import APIView
from rest_framework.generics import GenericAPIView
from rest_framework.response import Response
from rest_framework import status

from .models import ERPIntegration, InboundEvent
from .serializers import InboundEventSerializer


class InboundWebhookView(GenericAPIView):
    """Receive inbound webhook from ERP and store as InboundEvent.

    Endpoint: POST /api/erp/inbound/<int:integration_id>/
    Expected headers:
      - X-ERP-Signature: HMAC-SHA256 hex digest of raw body using inbound_secret
      - X-Event-ID: optional unique event id for idempotency
    Payload JSON shape (recommended): {"event_id": "...", "event_type": "order.created", "data": {...}}
    """

    serializer_class = InboundEventSerializer

    def post(self, request, integration_id):
        integration = get_object_or_404(ERPIntegration, pk=integration_id)

        raw = request.body or b''

        # Verify signature if secret configured
        sig_header = request.headers.get('X-ERP-Signature')
        if integration.inbound_secret:
            if not sig_header:
                return Response({'detail': 'Missing signature header'}, status=status.HTTP_400_BAD_REQUEST)
            computed = hmac.new(force_bytes(integration.inbound_secret), raw, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(computed, sig_header):
                return Response({'detail': 'Invalid signature'}, status=status.HTTP_403_FORBIDDEN)

        # Parse JSON
        try:
            payload = json.loads(raw.decode('utf-8')) if raw else {}
        except Exception:
            return Response({'detail': 'Invalid JSON payload'}, status=status.HTTP_400_BAD_REQUEST)

        # Extract event id/type
        event_id = payload.get('event_id') or request.headers.get('X-Event-ID')
        event_type = payload.get('event_type') or payload.get('type') or 'unknown'

        # Idempotency: if event_id present, avoid duplicate
        if event_id and InboundEvent.objects.filter(integration=integration, event_id=event_id).exists():
            return Response({'detail': 'Event already received'}, status=status.HTTP_200_OK)

        # Validate minimal shape using configured serializer
        serializer = self.get_serializer(data={
            'event_id': event_id,
            'event_type': event_type,
            'data': payload.get('data') or payload,
        })
        serializer.is_valid(raise_exception=True)

        # Persist
        ev = InboundEvent.objects.create(
            integration=integration,
            event_id=event_id,
            event_type=event_type,
            payload=serializer.validated_data['data'],
        )

        # NOTE: processing is left to a worker/management command; here we accept
        return Response({'detail': 'accepted', 'id': ev.pk}, status=status.HTTP_202_ACCEPTED)
