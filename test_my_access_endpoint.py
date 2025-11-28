#!/usr/bin/env python
"""
Quick test script to verify the my_access endpoint works.
Run this in the Django shell or as a test.
"""

import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'qwms.settings')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'qwms'))

django.setup()

from django.contrib.auth import get_user_model
from django.db.models import Count
from core.models import Company, Warehouse, WarehouseUser, get_user_companies, get_user_warehouses
from inventory.models import Quant

User = get_user_model()

# Create or get a test user
user, created = User.objects.get_or_create(
    username='testuser',
    defaults={'email': 'test@example.com', 'is_staff': False}
)
print(f"User: {user.username} (staff={user.is_staff})")

# Get user's effective access
companies = get_user_companies(user)
warehouses = get_user_warehouses(user)

print(f"\nCompanies (explicit mappings): {list(companies.values_list('code', flat=True))}")
print(f"Warehouses (bound to user): {list(warehouses.values_list('code', flat=True))}")

# Simulate QuantViewSet access logic
if user.is_staff:
    visible_quants = Quant.objects.all()
    print("User is staff -> sees all quants")
else:
    if companies.exists() and warehouses.exists():
        visible_quants = Quant.objects.filter(bin__warehouse__in=warehouses, owner__in=companies)
        print(f"User has both companies and warehouses -> intersection semantics")
    elif warehouses.exists():
        visible_quants = Quant.objects.filter(bin__warehouse__in=warehouses)
        print(f"User has only warehouses -> sees quants in those warehouses")
    elif companies.exists():
        visible_quants = Quant.objects.filter(owner__in=companies)
        print(f"User has only companies -> sees quants owned by those companies")
    else:
        visible_quants = Quant.objects.none()
        print(f"User has no bindings -> sees no quants")

visible_quants = visible_quants.distinct()

print(f"\nTotal visible quants: {visible_quants.count()}")
by_owner = visible_quants.values('owner__name').annotate(count=Count('id'))
print(f"By owner: {list(by_owner)}")

print("\n✓ Test completed successfully")
