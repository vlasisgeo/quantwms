from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ERPIntegrationViewSet,
    InboundEventViewSet,
    DeliveryViewSet,
    InboundWebhookView,
)

router = DefaultRouter()
router.register(r'integrations', ERPIntegrationViewSet, basename='erp-integration')
router.register(r'inbound-events', InboundEventViewSet, basename='erp-inbound-event')
router.register(r'deliveries', DeliveryViewSet, basename='erp-delivery')

urlpatterns = [
    path('', include(router.urls)),
    # Public webhook endpoint — authenticated via HMAC, not JWT
    path('inbound/<int:integration_id>/', InboundWebhookView.as_view(), name='erp-inbound'),
]
