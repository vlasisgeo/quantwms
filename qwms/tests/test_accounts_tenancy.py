import pytest

from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory
from rest_framework.test import APIClient
from django.core.management import call_command

from core.models import Company, Warehouse

from accounts.middleware import TenantMiddleware
from accounts.permissions import IsCompanyMemberOrWarehouseStaff
from accounts.models import Membership, WarehouseAssignment

User = get_user_model()


@pytest.mark.django_db
def test_membership_allows_company_access():
    user = User.objects.create_user(username='u1', password='pass')
    company = Company.objects.create(code='C1', name='Company1')

    # No membership initially
    factory = APIRequestFactory()
    request = factory.get('/')
    request.user = user
    # set header so middleware resolves company
    request.META['HTTP_X_COMPANY_ID'] = str(company.id)

    # run middleware (MiddlewareMixin requires a get_response callable)
    TenantMiddleware(get_response=lambda req: None).process_request(request)

    perm = IsCompanyMemberOrWarehouseStaff()
    assert not perm.has_permission(request, None)

    # add membership
    Membership.objects.create(user=user, company=company, role=Membership.ROLE_OWNER)

    # new request object to avoid cached state
    request2 = factory.get('/')
    request2.user = user
    request2.META['HTTP_X_COMPANY_ID'] = str(company.id)
    TenantMiddleware(get_response=lambda req: None).process_request(request2)

    assert perm.has_permission(request2, None)


@pytest.mark.django_db
def test_warehouse_assignment_allows_staff_access():
    user = User.objects.create_user(username='staff1', password='pass')
    # create company and warehouse (warehouse belongs to company)
    company = Company.objects.create(code='C2', name='Company2')
    warehouse = Warehouse.objects.create(code='W1', name='WH1', company=company)

    # assign user to warehouse
    WarehouseAssignment.objects.create(user=user, warehouse=warehouse, can_manage=True)

    factory = APIRequestFactory()
    request = factory.get('/')
    request.user = user
    # Resolve company header for some other company (should not matter)
    request.META['HTTP_X_COMPANY_ID'] = str(company.id)

    TenantMiddleware(get_response=lambda req: None).process_request(request)

    perm = IsCompanyMemberOrWarehouseStaff()
    # user is not a member but has a warehouse assignment -> permission should allow
    assert perm.has_permission(request, None)


@pytest.mark.django_db
def test_membership_and_assignment_sync_to_core_mappings():
    """Membership and WarehouseAssignment are the canonical records in `accounts`.

    Ensure the helper functions reflect these records (no legacy `WarehouseUser`).
    """
    user = User.objects.create_user(username='sync_user', password='pass')
    company = Company.objects.create(code='C3', name='Company3')
    warehouse = Warehouse.objects.create(code='W2', name='WH2', company=company)

    # Create Membership -> should appear in accounts.Membership
    m = Membership.objects.create(user=user, company=company, role=Membership.ROLE_ADMIN)
    # get_user_companies should include the company
    from core.models import get_user_companies, get_user_warehouses

    assert company in list(get_user_companies(user))

    # Create WarehouseAssignment -> should appear in accounts.WarehouseAssignment
    wa = WarehouseAssignment.objects.create(user=user, warehouse=warehouse, can_manage=False)
    assert warehouse in list(get_user_warehouses(user))

    # Deleting membership / assignment should update helpers
    m.delete()
    assert company not in list(get_user_companies(user))

    wa.delete()
    assert warehouse not in list(get_user_warehouses(user))


@pytest.mark.django_db
def test_end_to_end_quant_api_access_for_warehouse_staff():
    """End-to-end: staff assigned to a warehouse can GET quants in that warehouse."""
    user = User.objects.create_user(username='api_staff', password='pass')
    company = Company.objects.create(code='C4', name='Company4')
    warehouse = Warehouse.objects.create(code='W3', name='WH3', company=company)

    # create section, bin, item, quant
    from core.models import Section, Bin
    from inventory.models import Item, Quant, StockCategory, Lot

    section = Section.objects.create(warehouse=warehouse, code='S1')
    bin = Bin.objects.create(warehouse=warehouse, section=section, location_code='A1')
    item = Item.objects.create(sku='SKU-API-1', name='API Item')
    stock_cat = StockCategory.objects.first() or StockCategory.objects.create(code='UNRESTRICTED', name='Unrestricted')
    quant = Quant.objects.create(item=item, bin=bin, lot=None, stock_category=stock_cat, owner=company, qty=10)

    # assign staff to warehouse (accounts assignment is the source of truth)
    WarehouseAssignment.objects.create(user=user, warehouse=warehouse, can_manage=True)

    client = APIClient()
    client.force_authenticate(user=user)

    # call list endpoint
    resp = client.get('/api/quants/')
    assert resp.status_code == 200
    data = resp.json()
    # ensure our quant appears in results (page list)
    assert any(q.get('id') == quant.id or q.get('item') == item.id or q.get('owner') == company.id for q in data.get('results', data))


@pytest.mark.django_db
def test_backfill_command_creates_mappings(tmp_path):
    user = User.objects.create_user(username='backfill_user', password='pass')
    company = Company.objects.create(code='C5', name='Company5')
    warehouse = Warehouse.objects.create(code='W4', name='WH4', company=company)

    # create models but don't rely on signals: create memberships and assignments
    Membership.objects.create(user=user, company=company, role=Membership.ROLE_STAFF)
    WarehouseAssignment.objects.create(user=user, warehouse=warehouse, can_manage=False)

    # run backfill command (no-op since legacy mapping removed)
    call_command('backfill_warehouse_mappings', '--dry-run')
    call_command('backfill_warehouse_mappings')

    # Ensure accounts models still hold the mappings (backfill is no-op)
    assert Membership.objects.filter(user=user, company=company).exists()
    assert WarehouseAssignment.objects.filter(user=user, warehouse=warehouse).exists()
