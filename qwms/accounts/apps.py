from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accounts'
    verbose_name = 'Accounts (tenant & assignments)'

    def ready(self):
        # Import signals to register them when the app is ready
        try:
            import accounts.signals  # noqa: F401
        except Exception:
            # Avoid import-time errors in test harness; signals are best-effort
            pass
