import pytest
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model

from core.models import Company, Warehouse, Section, Bin, BinType

User = get_user_model()

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client():
    client = APIClient()
    user = User.objects.create_user(username="locuser", password="pass")
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def setup_location_data():
    company = Company.objects.create(code="COMP-T", name="TestCo")
    warehouse = Warehouse.objects.create(code="WH-T", name="Test WH", company=company)
    section = Section.objects.create(warehouse=warehouse, code="SEC-T", name="Test Section")
    bin_type = BinType.objects.create(name="Shelf", x_mm=1000, y_mm=500, z_mm=200)
    return {
        "company": company,
        "warehouse": warehouse,
        "section": section,
        "bin_type": bin_type,
    }


def test_create_single_location(api_client, setup_location_data):
    data = setup_location_data
    client = api_client

    payload = {
        "warehouse": data["warehouse"].id,
        "section": data["section"].id,
        "location_code": "A1-B01-L01",
        "bin_type": data["bin_type"].id,
        "note": "Test location",
    }

    resp = client.post("/api/bins/create-location/", payload, format="json")
    assert resp.status_code == 200
    body = resp.json()
    assert body["location_code"] == "A1-B01-L01"

    # Ensure Bin exists
    assert Bin.objects.filter(section=data["section"], location_code="A1-B01-L01").count() == 1


def test_duplicate_single_creation(api_client, setup_location_data):
    data = setup_location_data
    client = api_client

    payload = {
        "warehouse": data["warehouse"].id,
        "section": data["section"].id,
        "location_code": "A2-B01-L01",
    }

    resp1 = client.post("/api/bins/create-location/", payload, format="json")
    assert resp1.status_code == 200
    assert Bin.objects.filter(section=data["section"], location_code="A2-B01-L01").count() == 1

    # POST again same payload -> should not create new Bin
    resp2 = client.post("/api/bins/create-location/", payload, format="json")
    assert resp2.status_code == 200
    assert Bin.objects.filter(section=data["section"], location_code="A2-B01-L01").count() == 1


def test_mass_create_dexion(api_client, setup_location_data):
    data = setup_location_data
    client = api_client

    payload = {
        "warehouse": data["warehouse"].id,
        "section": data["section"].id,
        "aisle_from": 1,
        "aisle_to": 2,
        "bay_from": 1,
        "bay_to": 2,
        "level_from": 1,
        "level_to": 2,
        "format": "A{aisle}-B{bay}-L{level}",
        "pad_aisle": 0,
        "pad_bay": 2,
        "pad_level": 2,
    }

    resp = client.post("/api/bins/mass-create-dexion/", payload, format="json")
    assert resp.status_code == 200
    body = resp.json()
    # Expect 2*2*2 = 8 created entries
    assert len(body["created"]) == 8
    assert body["skipped"] == 0

    # Running again should skip all (existing)
    resp2 = client.post("/api/bins/mass-create-dexion/", payload, format="json")
    assert resp2.status_code == 200
    body2 = resp2.json()
    # created entries length still 8 (but marked existing)
    assert len(body2["created"]) == 8
    assert body2["skipped"] == 8 or all(item.get("existing", False) for item in body2["created"])  # either skipped count or existing flags


def test_zpl_single_create(api_client, setup_location_data):
    data = setup_location_data
    client = api_client

    payload = {
        "warehouse": data["warehouse"].id,
        "section": data["section"].id,
        "location_code": "ZPL-A1-B01-L01",
    }

    resp = client.post("/api/bins/create-location/?print=1", payload, format="json")
    assert resp.status_code == 200
    text = resp.content.decode('utf-8')

    # Verify ZPL contains warehouse, section, and location labels
    assert f"WH:{data['warehouse'].code}" in text
    assert f"SEC:{data['section'].code}" in text
    assert "LOC:ZPL-A1-B01-L01" in text

    # Verify barcode (UUID) for the created bin appears in the ZPL
    bin_obj = Bin.objects.get(section=data["section"], location_code="ZPL-A1-B01-L01")
    assert str(bin_obj.code) in text


def test_zpl_mass_create(api_client, setup_location_data):
    data = setup_location_data
    client = api_client

    payload = {
        "warehouse": data["warehouse"].id,
        "section": data["section"].id,
        "aisle_from": 1,
        "aisle_to": 2,
        "bay_from": 1,
        "bay_to": 2,
        "level_from": 1,
        "level_to": 2,
        "format": "A{aisle}-B{bay}-L{level}",
        "pad_aisle": 0,
        "pad_bay": 2,
        "pad_level": 2,
    }

    resp = client.post("/api/bins/mass-create-dexion/?print=1", payload, format="json")
    assert resp.status_code == 200
    text = resp.content.decode('utf-8')

    # Validate that ZPL contains warehouse and section markers
    assert f"WH:{data['warehouse'].code}" in text
    assert f"SEC:{data['section'].code}" in text

    # Ensure each expected location code and its barcode appear in the ZPL output
    # Respect padding used in the payload (pad_bay=2, pad_level=2)
    pad_aisle = 0
    pad_bay = 2
    pad_level = 2
    expected_locations = []
    for aisle in range(1, 2 + 1):
        for bay in range(1, 2 + 1):
            for level in range(1, 2 + 1):
                aisle_str = str(aisle).rjust(pad_aisle, '0') if pad_aisle > 0 else str(aisle)
                bay_str = str(bay).rjust(pad_bay, '0')
                level_str = str(level).rjust(pad_level, '0')
                expected_locations.append(f"A{aisle_str}-B{bay_str}-L{level_str}")

    for loc in expected_locations:
        assert f"LOC:{loc}" in text

    # Ensure the barcode UUIDs for created bins are present
    bins = Bin.objects.filter(section=data['section'])
    for b in bins:
        assert str(b.code) in text
