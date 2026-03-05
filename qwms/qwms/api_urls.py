"""URL configuration for the WMS API."""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    """Return basic info about the authenticated user."""
    user = request.user
    return Response({
        'id': user.pk,
        'username': user.username,
        'email': user.email,
        'is_staff': user.is_staff,
    })

from core.views import (
    CompanyViewSet,
    WarehouseViewSet,
    SectionViewSet,
    BinTypeViewSet,
    BinViewSet,
    WarehouseUserViewSet,
)
from inventory.views import (
    ItemCategoryViewSet,
    ItemViewSet,
    LotViewSet,
    StockCategoryViewSet,
    QuantViewSet,
    MovementViewSet,
)
from orders.views import DocumentViewSet, DocumentLineViewSet, ReservationViewSet, FulfilmentLogViewSet
from accounts.views import CompanyWebhookViewSet
from django.urls import include, path as _path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView

# Create router and register viewsets
router = DefaultRouter()

# Core
router.register(r"companies", CompanyViewSet, basename="company")
router.register(r"warehouses", WarehouseViewSet, basename="warehouse")
router.register(r"sections", SectionViewSet, basename="section")
router.register(r"bin-types", BinTypeViewSet, basename="bin-type")
router.register(r"bins", BinViewSet, basename="bin")
router.register(r"warehouse-users", WarehouseUserViewSet, basename="warehouse-user")

# Inventory
router.register(r"item-categories", ItemCategoryViewSet, basename="item-category")
router.register(r"items", ItemViewSet, basename="item")
router.register(r"lots", LotViewSet, basename="lot")
router.register(r"stock-categories", StockCategoryViewSet, basename="stock-category")
router.register(r"quants", QuantViewSet, basename="quant")
router.register(r"movements", MovementViewSet, basename="movement")

# Orders
router.register(r"documents", DocumentViewSet, basename="document")
router.register(r"document-lines", DocumentLineViewSet, basename="document-line")
router.register(r"reservations", ReservationViewSet, basename="reservation")
router.register(r"fulfilment-logs", FulfilmentLogViewSet, basename="fulfilment-log")

# Accounts
router.register(r"webhooks", CompanyWebhookViewSet, basename="webhook")

urlpatterns = [
    # Router URLs
    path("", include(router.urls)),
    # JWT Auth
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/me/", me_view, name="auth-me"),
    _path('erp/', include('erp_connector.urls')),
    # OpenAPI / Swagger / Redoc
    path('schema/', SpectacularAPIView.as_view(), name='schema'),
    path('schema/swagger-ui/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('schema/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),
]
