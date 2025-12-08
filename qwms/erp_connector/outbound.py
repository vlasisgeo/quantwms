import hmac
import hashlib
import time
import json
from typing import Optional

import requests
from django.utils import timezone

from .models import Delivery, ERPIntegration


class OutboundClient:
    """Simple HTTP client for sending signed outbound ERP webhooks.

    Signs payloads with HMAC-SHA256 using the integration.outbound_auth_token
    as the secret and sends to integration.outbound_base_url + endpoint.
    """

    def __init__(self, integration: ERPIntegration, timeout: int = 10):
        self.integration = integration
        self.timeout = timeout

    def _sign(self, body: bytes, timestamp: Optional[int] = None) -> str:
        if timestamp is None:
            timestamp = int(time.time())
        secret = (self.integration.outbound_auth_token or "").encode('utf-8')
        msg = b"%d." % timestamp + body
        signature = hmac.new(secret, msg, hashlib.sha256).hexdigest()
        return f"t={timestamp},v1={signature}"

    def send(self, endpoint: str, payload: dict, max_attempts: int = 3) -> (bool, Optional[str]):
        """Send payload to endpoint (relative path) and return (success, error_message).

        The full URL is constructed from integration.outbound_base_url.
        """
        if not self.integration.outbound_base_url:
            return False, "no outbound_base_url configured"

        url = self.integration.outbound_base_url.rstrip('/') + '/' + endpoint.lstrip('/')
        body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        signature = self._sign(body)
        headers = {
            'Content-Type': 'application/json',
            'X-ERP-Signature': signature,
        }

        try:
            resp = requests.post(url, data=body, headers=headers, timeout=self.timeout)
        except Exception as exc:
            return False, f"request-error:{exc}"

        if 200 <= resp.status_code < 300:
            return True, None
        return False, f"status={resp.status_code} body={resp.text}"


def send_delivery(delivery: Delivery, endpoint: str = '/inbound/') -> None:
    """Attempt to send a Delivery record and update its status.

    This function is resilient to exceptions and updates `attempts`, `sent_at`,
    `status` and `last_error` on the Delivery instance.
    """
    integration = delivery.integration
    client = OutboundClient(integration)
    success, error = client.send(endpoint, delivery.payload)

    delivery.attempts += 1
    if success:
        delivery.status = Delivery.STATUS_SENT
        delivery.sent_at = timezone.now()
        delivery.last_error = ''
    else:
        delivery.status = Delivery.STATUS_FAILED if delivery.attempts >= 3 else Delivery.STATUS_PENDING
        delivery.last_error = error or ''
    delivery.save()
