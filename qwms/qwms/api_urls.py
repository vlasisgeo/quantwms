"""URL configuration for the WMS API."""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

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
from orders.views import DocumentViewSet, DocumentLineViewSet, ReservationViewSet
from django.urls import include, path as _path

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

urlpatterns = [
    # Router URLs
    path("", include(router.urls)),
    # JWT Auth
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    _path('erp/', include('erp_connector.urls')),
]
