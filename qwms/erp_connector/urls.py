from django.urls import path
from .views import InboundWebhookView

urlpatterns = [
    path('inbound/<int:integration_id>/', InboundWebhookView.as_view(), name='erp-inbound'),
]
