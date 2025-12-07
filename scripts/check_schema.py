import os
import sys

# Ensure project path
BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'qwms'))
sys.path.insert(0, BASE)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'qwms.settings')

import django
from django.test import Client

django.setup()

client = Client()
try:
    resp = client.get('/api/schema/')
    print('STATUS:', resp.status_code)
    print(resp.content.decode('utf-8'))
except Exception as e:
    import traceback

    print('EXCEPTION:')
    traceback.print_exc()
