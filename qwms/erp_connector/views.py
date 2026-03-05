import hmac
import hashlib
import json

from django.shortcuts import get_object_or_404
from django.utils.encoding import force_bytes
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ERPIntegration, InboundEvent, Delivery
from .serializers import ERPIntegrationSerializer, InboundEventSerializer, DeliverySerializer


class ERPIntegrationViewSet(viewsets.ModelViewSet):
    """CRUD for ERP Integration configurations. Admin-only writes."""

    queryset = ERPIntegration.objects.select_related('company', 'default_warehouse')
    serializer_class = ERPIntegrationSerializer
    filterset_fields = ['company']
    search_fields = ['name', 'company__name']
    ordering_fields = ['created_at', 'name']
    ordering = ['-created_at']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return ERPIntegration.objects.select_related('company', 'default_warehouse')
        from core.models import get_user_companies
        companies = get_user_companies(user)
        return ERPIntegration.objects.select_related(
            'company', 'default_warehouse'
        ).filter(company__in=companies)

    @action(detail=True, methods=['post'])
    def sync_orders(self, request, pk=None):
        """Trigger an immediate pull of orders from the eshop.
        POST /api/erp-integrations/{id}/sync_orders/
        """
        integration = self.get_object()
        from .sync import pull_orders
        count = pull_orders(integration)
        return Response({'status': 'ok', 'orders_ingested': count})

    @action(detail=True, methods=['post'])
    def push_inventory(self, request, pk=None):
        """Queue an inventory snapshot delivery to the eshop.
        POST /api/erp-integrations/{id}/push_inventory/
        """
        integration = self.get_object()
        from .sync import push_inventory
        count = push_inventory(integration)
        return Response({'status': 'queued', 'quants_included': count})

    @action(detail=True, methods=['post'])
    def send_pending(self, request, pk=None):
        """Immediately flush all pending outbound deliveries for this integration.
        POST /api/erp-integrations/{id}/send_pending/
        """
        integration = self.get_object()
        from .outbound import send_delivery
        qs = Delivery.objects.filter(integration=integration, status=Delivery.STATUS_PENDING)
        sent = failed = 0
        for d in qs:
            send_delivery(d)
            if d.status == Delivery.STATUS_SENT:
                sent += 1
            else:
                failed += 1
        return Response({'status': 'ok', 'sent': sent, 'failed': failed})


class InboundEventViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only list/detail of inbound events. Admin can trigger manual reprocess."""

    queryset = InboundEvent.objects.select_related('integration')
    serializer_class = InboundEventSerializer
    filterset_fields = ['integration', 'event_type', 'processed']
    search_fields = ['event_id', 'event_type']
    ordering_fields = ['received_at', 'processed']
    ordering = ['-received_at']

    def get_permissions(self):
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return InboundEvent.objects.select_related('integration')
        from core.models import get_user_companies
        companies = get_user_companies(user)
        return InboundEvent.objects.select_related('integration').filter(
            integration__company__in=companies
        )

    @action(detail=True, methods=['post'])
    def reprocess(self, request, pk=None):
        """Manually re-run processing for a failed/unprocessed event.
        POST /api/inbound-events/{id}/reprocess/
        """
        ev = self.get_object()
        ev.processed = False
        ev.attempts = 0
        ev.last_error = ''
        ev.save()
        from .processor import process_event
        success = process_event(ev)
        return Response(
            {'status': 'success' if success else 'failed', 'last_error': ev.last_error},
            status=status.HTTP_200_OK,
        )


class DeliveryViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only list/detail of outbound deliveries. Admin can retry failed ones."""

    queryset = Delivery.objects.select_related('integration')
    serializer_class = DeliverySerializer
    filterset_fields = ['integration', 'status', 'event_type']
    search_fields = ['event_type']
    ordering_fields = ['created_at', 'sent_at', 'status']
    ordering = ['-created_at']

    def get_permissions(self):
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return Delivery.objects.select_related('integration')
        from core.models import get_user_companies
        companies = get_user_companies(user)
        return Delivery.objects.select_related('integration').filter(
            integration__company__in=companies
        )

    @action(detail=True, methods=['post'])
    def retry(self, request, pk=None):
        """Reset a FAILED delivery back to PENDING so it gets picked up again.
        POST /api/deliveries/{id}/retry/
        """
        delivery = self.get_object()
        if delivery.status == Delivery.STATUS_SENT:
            return Response({'error': 'Delivery already sent'}, status=status.HTTP_400_BAD_REQUEST)
        delivery.status = Delivery.STATUS_PENDING
        delivery.attempts = 0
        delivery.last_error = ''
        delivery.save()
        return Response({'status': 'reset to pending'})


class InboundWebhookView(APIView):
    """Receive inbound webhook from the eshop and store + process immediately.

    POST /api/erp/inbound/<integration_id>/

    Headers:
      X-ERP-Signature  HMAC-SHA256 hex of raw body (required if inbound_secret set)
      X-Event-ID       Optional idempotency key

    Body:
      {"event_id": "...", "event_type": "order.created", "data": {...}}
    """

    authentication_classes = []  # public endpoint — auth via HMAC signature
    permission_classes = []

    def post(self, request, integration_id):
        integration = get_object_or_404(ERPIntegration, pk=integration_id)
        raw = request.body or b''

        # Verify HMAC signature if secret is configured
        if integration.inbound_secret:
            sig_header = request.headers.get('X-ERP-Signature', '')
            if not sig_header:
                return Response({'detail': 'Missing X-ERP-Signature header'}, status=400)
            computed = hmac.new(
                force_bytes(integration.inbound_secret), raw, hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(computed, sig_header):
                return Response({'detail': 'Invalid signature'}, status=403)

        # Parse JSON body
        try:
            payload = json.loads(raw.decode('utf-8')) if raw else {}
        except Exception:
            return Response({'detail': 'Invalid JSON payload'}, status=400)

        event_id = payload.get('event_id') or request.headers.get('X-Event-ID')
        event_type = payload.get('event_type') or payload.get('type') or 'unknown'
        data = payload.get('data') or payload

        # Idempotency check
        if event_id and InboundEvent.objects.filter(
            integration=integration, event_id=event_id
        ).exists():
            return Response({'detail': 'Event already received'}, status=200)

        ev = InboundEvent.objects.create(
            integration=integration,
            event_id=event_id,
            event_type=event_type,
            payload=data,
        )

        # Process inline; fall back to Celery async if available
        try:
            from .tasks import process_inbound_event
            process_inbound_event.delay(ev.pk)
            async_queued = True
        except Exception:
            from .processor import process_event
            process_event(ev)
            async_queued = False

        return Response(
            {'detail': 'accepted', 'id': ev.pk, 'async': async_queued},
            status=202,
        )
