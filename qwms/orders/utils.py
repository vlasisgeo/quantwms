"""Utility helpers for the orders app."""

import hmac
import hashlib
import json
import logging
from urllib.request import urlopen, Request
from urllib.error import URLError

logger = logging.getLogger(__name__)


def fire_webhooks(company, event_type: str, payload: dict) -> None:
    """POST ``payload`` to every active webhook for ``company`` that listens to ``event_type``.

    Failures are logged as warnings and never re-raised — webhook delivery
    must never break the caller's response.

    In production, replace the synchronous ``urlopen`` calls with a Celery
    task so that slow or unreachable endpoints don't add latency to the API.
    """
    try:
        from accounts.models import CompanyWebhook
    except ImportError:
        return

    webhooks = CompanyWebhook.objects.filter(company=company, active=True)
    body = json.dumps(payload, default=str).encode()

    for wh in webhooks:
        if event_type not in (wh.event_types or []):
            continue

        headers = {
            "Content-Type": "application/json",
            "X-WMS-Event": event_type,
        }
        if wh.secret:
            sig = hmac.new(wh.secret.encode(), body, hashlib.sha256).hexdigest()
            headers["X-WMS-Signature"] = f"sha256={sig}"

        try:
            req = Request(wh.url, data=body, headers=headers, method="POST")
            with urlopen(req, timeout=5):
                pass
            logger.debug("Webhook delivered: %s → %s", event_type, wh.url)
        except (URLError, OSError, Exception) as exc:
            logger.warning("Webhook delivery failed to %s (%s): %s", wh.url, event_type, exc)
