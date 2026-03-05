"""Views for the accounts app."""

from rest_framework import viewsets, permissions, serializers as drf_serializers
from accounts.models import CompanyWebhook


class CompanyWebhookSerializer(drf_serializers.ModelSerializer):
    company_name = drf_serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = CompanyWebhook
        fields = [
            "id",
            "company",
            "company_name",
            "url",
            "event_types",
            "active",
            "secret",
            "created_at",
        ]
        extra_kwargs = {
            "secret": {"write_only": True},
        }


class CompanyWebhookViewSet(viewsets.ModelViewSet):
    """Manage webhook endpoints for a company.

    Company admins/owners can register URLs to receive event callbacks:
      fulfil.success, fulfil.partial, fulfil.failed

    The ``secret`` field is write-only — set it to sign deliveries with
    HMAC-SHA256 (X-WMS-Signature header on each POST).
    """

    queryset = CompanyWebhook.objects.select_related("company")
    serializer_class = CompanyWebhookSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["company", "active"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return CompanyWebhook.objects.select_related("company")

        from core.models import get_user_companies

        companies = get_user_companies(user)
        return CompanyWebhook.objects.select_related("company").filter(
            company__in=companies
        ).distinct()
