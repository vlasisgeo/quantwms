from django.apps import AppConfig


class ERPConnectorConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'erp_connector'
    verbose_name = 'ERP Connector'

    def ready(self):
        import erp_connector.signals  # noqa: F401 — registers signal handlers
