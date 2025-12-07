import os, sys
BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'qwms'))
sys.path.insert(0, BASE)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'qwms.settings')
import django
django.setup()

from rest_framework.test import APIRequestFactory
from drf_spectacular.views import SpectacularAPIView

try:
    factory = APIRequestFactory()
    req = factory.get('/api/schema/')
    view = SpectacularAPIView.as_view()
    resp = view(req)
    # resp may be a Response object or an exception
    try:
        content = resp.render().content
        print(content.decode('utf-8'))
    except Exception:
        print(repr(resp))
except Exception:
    import traceback
    traceback.print_exc()
