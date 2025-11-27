"""
Pytest configuration and fixtures for QuantWMS tests.
"""

import os
import django
from django.conf import settings


def pytest_configure():
    """Configure Django settings for pytest."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'qwms.settings')
    
    if not settings.configured:
        django.setup()


# This file makes the tests/ directory a Python package
