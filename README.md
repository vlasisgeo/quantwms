# QuantWMS — Warehouse Management System API

A production-ready, multi-tenant WMS API built with Django REST Framework, featuring:

- **Multi-warehouse, multi-client** inventory management
- **Quant-based** inventory tracking (item + bin + lot + category + owner)
- **Lots/batches** with optional expiry dates and FEFO support
- **Atomic transactions** with `SELECT FOR UPDATE` for concurrency safety
- **Full order lifecycle**: document creation → allocation → picking → completion
- **Audit trail** via immutable Movement log
- **OpenAPI schema** with interactive Swagger UI
- **JWT authentication** for API security

---

## Quick Start

### Prerequisites

- Python 3.10+
- Django 5.2+
- SQLite (dev), PostgreSQL (prod recommended)

### 1. Activate Virtual Environment

```powershell
.\.venv\Scripts\Activate.ps1
```

### 2. Install Dependencies

```powershell
pip install -r requirements.txt
```

Or manually:
```powershell
pip install django djangorestframework djangorestframework-simplejwt drf-spectacular django-filter psycopg2-binary
```

### 3. Run Migrations

```powershell
cd qwms
python manage.py migrate
```

### 4. Create Superuser (Admin)

```powershell
python manage.py createsuperuser
```

### 5. Start Development Server

```powershell
python manage.py runserver
```

Server runs on `http://127.0.0.1:8000/`

### 6. Access API Documentation

- **Swagger UI**: http://127.0.0.1:8000/api/docs/
- **OpenAPI Schema**: http://127.0.0.1:8000/api/schema/
- **Admin Interface**: http://127.0.0.1:8000/admin/

---

## Core Concepts

### Quant (Inventory Unit)

A **Quant** represents a unique quantity of an item at a specific location:

```
Quant = Item + Bin + Lot (optional) + StockCategory + Owner (Company) + Qty
```

- **Item**: product SKU
- **Bin**: physical storage location (warehouse → section → location)
- **Lot**: production batch (optional, enables FEFO by expiry date)
- **StockCategory**: UNRESTRICTED, BLOCKED, QUALITY_CHECK, CONSIGNMENT
- **Owner**: the Company that owns this stock (multi-tenant)
- **Qty**: available quantity (always ≥ 0)
- **Qty_Reserved**: quantity allocated to orders but not yet picked

### Document (Order)

A **Document** represents an order, transfer, or receipt:
- **Outbound Order** (100): customer delivery
- **Transfer Order** (110): warehouse-to-warehouse
- **Inbound Receipt** (120): supplier receipt
- **Adjustment** (130): inventory adjustment

Each Document has **DocumentLines** (items + qty) and **Reservations** (allocation to Quants).

### Movement (Audit Log)

Immutable records of all inventory transactions (INBOUND, RESERVED, OUTBOUND, TRANSFER, ADJUSTMENT).

---

## API Endpoints

### Authentication

Get JWT token (required for all requests):

```bash
POST /api/auth/token/
Content-Type: application/json

{
  "username": "your_username",
  "password": "your_password"
}

# Response:
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

Use the `access` token in all requests:

```bash
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
```

---

### Core: Companies, Warehouses, Bins

#### Create a Company

```bash
POST /api/companies/
{
  "code": "COMP001",
  "name": "ABC Corporation",
  "vat_no": "BE0123456789",
  "address": "123 Main St, Brussels"
}
```

#### Create a Warehouse

```bash
POST /api/warehouses/
{
  "code": "WH001",
  "name": "Main Warehouse",
  "company": 1,
  "address": "10 Industrial Blvd, Brussels"
}
```

#### Create a Section

```bash
POST /api/sections/
{
  "warehouse": 1,
  "code": "SEC-A",
  "name": "Section A - High Shelf"
}
```

#### Create a Bin

```bash
POST /api/bins/
{
  "warehouse": 1,
  "section": 1,
  "location_code": "A-01-001",
  "bin_type": 1
}
```

#### Get All Bins

```bash
GET /api/bins/?warehouse=1&active=true
```

#### Check Bin Inventory

```bash
GET /api/bins/{id}/inventory/

# Response:
{
  "bin": "WH001:SEC-A:A-01-001",
  "items": [
    {
      "item_sku": "SKU-001",
      "item_name": "Widget A",
      "lot": "BATCH-2025-001",
      "category": "UNRESTRICTED",
      "qty": 100,
      "reserved": 50,
      "available": 50
    }
  ],
  "total_slots": 1
}
```

---

### Inventory: Items, Lots, Stock

#### Create an Item

```bash
POST /api/items/
{
  "sku": "SKU-001",
  "name": "Widget A",
  "description": "High-quality widget",
  "category": 1,
  "length_mm": 100,
  "width_mm": 50,
  "height_mm": 25,
  "weight_grams": 500,
  "fragile": true
}
```

#### Create a Lot (Batch)

```bash
POST /api/lots/
{
  "item": 1,
  "lot_code": "BATCH-2025-001",
  "expiry_date": "2026-12-31",
  "manufacture_date": "2025-01-15"
}
```

---

### Inventory: Receiving Goods

#### Receive Goods (Create/Add to Quant)

```bash
POST /api/quants/receive_goods/
{
  "bin_id": 1,
  "item_sku": "SKU-001",
  "qty": 100,
  "lot_code": "BATCH-2025-001",
  "stock_category": "UNRESTRICTED",
  "owner_id": 1,
  "notes": "Received from supplier XYZ"
}

# Response: Quant object
{
  "id": 5,
  "item_sku": "SKU-001",
  "bin_location": "A-01-001",
  "lot_code": "BATCH-2025-001",
  "qty": 100,
  "qty_reserved": 0,
  "qty_available": 100
}
```

---

### Inventory: Querying Stock Levels

#### Get Inventory by Item

```bash
GET /api/quants/by_item/?item_id=1&warehouse_id=1

# Response:
{
  "item_sku": "SKU-001",
  "total_qty": 500,
  "total_reserved": 100,
  "total_available": 400,
  "by_bin": [
    {
      "bin": "WH001:SEC-A:A-01-001",
      "lot": "BATCH-2025-001",
      "category": "UNRESTRICTED",
      "qty": 100,
      "reserved": 50,
      "available": 50
    },
    {
      "bin": "WH001:SEC-A:A-01-002",
      "lot": "BATCH-2025-002",
      "category": "UNRESTRICTED",
      "qty": 200,
      "reserved": 0,
      "available": 200
    }
  ]
}
```

---

### Inventory: Transfers

#### Transfer Quantity Between Bins

```bash
POST /api/quants/transfer/
{
  "from_quant_id": 5,
  "to_quant_id": 6,
  "qty": 50,
  "notes": "Move to high-traffic bin"
}

# Response:
{
  "status": "success",
  "from_quant": { ... },
  "to_quant": { ... }
}
```

---

### Orders: Full Workflow

#### Step 1: Create an Outbound Order

```bash
POST /api/documents/create_document/
{
  "doc_number": "SO-001",
  "doc_type": 100,
  "warehouse_id": 1,
  "owner_id": 1,
  "erp_doc_number": "ERP-SO-001",
  "notes": "Customer order from Acme Corp"
}

# Response:
{
  "id": 1,
  "doc_number": "SO-001",
  "status": 10,
  "total_qty_requested": 0,
  "total_qty_allocated": 0,
  "total_qty_picked": 0
}
```

#### Step 2: Add Lines to the Order

```bash
POST /api/documents/1/add_line/
{
  "item_sku": "SKU-001",
  "qty_requested": 50,
  "price": "10.50",
  "discount_percent": "5.00",
  "notes": "High-priority line"
}

# Response:
{
  "id": 1,
  "item_sku": "SKU-001",
  "qty_requested": 50,
  "qty_allocated": 0,
  "qty_picked": 0
}
```

#### Step 3: Reserve (Allocate) All Lines

```bash
POST /api/documents/1/reserve/
{
  "strategy": "FIFO"
}

# Response:
{
  "status": "success",
  "results": {
    "allocated_lines": [1],
    "partially_allocated_lines": [],
    "unallocated_lines": []
  },
  "document": {
    "doc_number": "SO-001",
    "status": 40,
    "total_qty_allocated": 50,
    "total_qty_picked": 0
  }
}
```

**Allocation Strategies:**
- **FIFO** (First-In-First-Out): oldest inventory first
- **FEFO** (First-Expired-First-Out): earliest expiry date first (requires lots with expiry_date)

#### Step 4: List Reservations

```bash
GET /api/reservations/?line=1

# Response: List of Reservation objects
[
  {
    "id": 1,
    "line": 1,
    "quant_bin_location": "A-01-001",
    "qty": 50,
    "qty_picked": 0,
    "qty_remaining": 50
  }
]
```

#### Step 5: Pick a Reservation

```bash
POST /api/reservations/1/pick/
{
  "qty": 50
}

# Response:
{
  "status": "picked",
  "reservation": {
    "id": 1,
    "qty": 50,
    "qty_picked": 50,
    "qty_remaining": 0
  }
}
```

#### Step 6: Verify Document Completion

```bash
GET /api/documents/1/

# Response shows:
{
  "doc_number": "SO-001",
  "status": 60,
  "total_qty_picked": 50,
  "qty_remaining": 0,
  "is_completed": true
}
```

---

### Orders: Cancellation

#### Cancel a Document and Release Reservations

```bash
POST /api/documents/1/cancel/

# Response:
{
  "status": "canceled",
  "document": {
    "doc_number": "SO-001",
    "status": 80
  }
}
```

---

### Audit Trail: Movements

#### Get All Movements

```bash
GET /api/movements/?warehouse=1&movement_type=OUTBOUND

# Response: List of Movement objects
[
  {
    "id": 1,
    "item_sku": "SKU-001",
    "from_quant_id": 5,
    "to_quant_id": null,
    "qty": 50,
    "movement_type": "OUTBOUND",
    "warehouse_code": "WH001",
    "reference": "pick:SO-001",
    "created_by_username": "operator1",
    "created_at": "2025-01-15T10:30:00Z"
  }
]
```

---

## Example: Complete End-to-End Flow

### 1. Setup: Create Tenant, Warehouse, and Stock

```bash
# Create company
POST /api/companies/
{
  "code": "TENANT-001",
  "name": "Big Retailer Inc",
  "vat_no": "US123456789"
}
# Returns: {"id": 1, "code": "TENANT-001", ...}

# Create warehouse
POST /api/warehouses/
{
  "code": "WH-CHICAGO",
  "name": "Chicago Distribution Center",
  "company": 1
}
# Returns: {"id": 1, "code": "WH-CHICAGO", ...}

# Create section
POST /api/sections/
{
  "warehouse": 1,
  "code": "HIGH-SHELF",
  "name": "High shelf racks"
}
# Returns: {"id": 1, ...}

# Create bin
POST /api/bins/
{
  "warehouse": 1,
  "section": 1,
  "location_code": "HS-01-01"
}
# Returns: {"id": 1, "code": "550e8400-e29b-41d4-a716-446655440000", ...}

# Create item
POST /api/items/
{
  "sku": "LAPTOP-PRO",
  "name": "Laptop Pro 15in",
  "weight_grams": 1800,
  "fragile": true
}
# Returns: {"id": 1, "sku": "LAPTOP-PRO", ...}
```

### 2. Receive Goods

```bash
# Receive 200 units
POST /api/quants/receive_goods/
{
  "bin_id": 1,
  "item_sku": "LAPTOP-PRO",
  "qty": 200,
  "stock_category": "UNRESTRICTED",
  "owner_id": 1
}
# Returns: {"id": 1, "qty": 200, "qty_available": 200}
```

### 3. Create and Fulfill Order

```bash
# Create order
POST /api/documents/create_document/
{
  "doc_number": "ORD-2025-001",
  "doc_type": 100,
  "warehouse_id": 1,
  "owner_id": 1
}
# Returns: {"id": 1, "doc_number": "ORD-2025-001", "status": 10}

# Add line: customer wants 50 units
POST /api/documents/1/add_line/
{
  "item_sku": "LAPTOP-PRO",
  "qty_requested": 50
}
# Returns: {"id": 1, "qty_requested": 50, "qty_allocated": 0}

# Reserve (allocate)
POST /api/documents/1/reserve/
{
  "strategy": "FIFO"
}
# Returns: allocated_lines: [1]

# List reservations
GET /api/reservations/?line=1
# Returns: [{"id": 1, "qty": 50, "qty_picked": 0}]

# Pick the order
POST /api/reservations/1/pick/
{
  "qty": 50
}
# Returns: {"status": "picked"}

# Verify completion
GET /api/documents/1/
# Returns: {"is_completed": true, "qty_remaining": 0}
```

### 4. Check Audit Trail

```bash
GET /api/movements/?warehouse=1
# Shows INBOUND (receive), RESERVED, OUTBOUND (pick) entries
```

---

## Key Features

### Multi-Tenancy
- Each Company can own stock across multiple Warehouses
- Quants track Owner (Company) so same warehouse can hold multiple tenants' inventory
- API filters automatically by user permissions

### Transaction Safety
- All inventory operations use `@transaction.atomic` and `SELECT FOR UPDATE`
- Prevents double-allocations even under high concurrency
- Unique constraint on (item, bin, lot, category, owner) ensures no duplicates

### FEFO Support (Expiry-based Picking)
- Lots store `expiry_date`
- Reserve strategy `FEFO` sorts by expiry date and picks soonest-expiring first
- Movement audit log tracks which lot was picked and when

### Multi-Step Picking Workflows
1. **Reserve** (allocate): create Reservation records, lock available qty
2. **Pick** (execute): deduct from Quant, mark picked, create Movement
3. **Partial Picks**: reserve/pick any qty ≤ reserved

### Flexible Stock Categories
- UNRESTRICTED: normal inventory
- BLOCKED: do not pick (damage, recall, etc.)
- QUALITY_CHECK: under inspection
- CONSIGNMENT: customer-owned but stored with us

---

## Testing

### Run Tests (when implemented)

```bash
pytest
# or
python manage.py test
```

### Manual Testing with curl

```bash
# Get token
curl -X POST http://127.0.0.1:8000/api/auth/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'

# Use token
curl http://127.0.0.1:8000/api/companies/ \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

---

## Deployment

### Production Checklist

- [ ] Use PostgreSQL instead of SQLite
- [ ] Set `DEBUG = False` in settings
- [ ] Use environment variables for secrets (django-environ)
- [ ] Configure allowed hosts and CORS
- [ ] Use Gunicorn or uWSGI as WSGI server
- [ ] Run behind Nginx or Apache reverse proxy
- [ ] Set up SSL/TLS certificates
- [ ] Configure logging and monitoring (Sentry, etc.)
- [ ] Use Celery + Redis for background jobs
- [ ] Set up database backups

### Docker

(Docker Compose file to be added)

---

## Troubleshooting

### 401 Unauthorized

- Token may be expired. Get a new one at `/api/auth/token/`
- Ensure token is in `Authorization: Bearer <TOKEN>` header

### 400 Bad Request

- Check request payload JSON format
- Verify foreign key IDs exist
- Review error details in response body

### 409 Conflict (Allocation Failed)

- Insufficient available quantity to reserve
- Quant may be from different warehouse
- Stock category may be BLOCKED or QUALITY_CHECK

### 404 Not Found

- Resource (item, bin, warehouse, etc.) does not exist
- Check the ID is correct

---

## Next Steps

1. **Write integration tests** for concurrency scenarios
2. **Set up PostgreSQL** for production
3. **Implement Celery** for async tasks (notifications, reports)
4. **Add filtering/search** endpoints (advanced queries)
5. **Dockerize** the application
6. **Add rate limiting** and throttling
7. **Monitor performance** under load

---

## Support

For API documentation, visit: http://127.0.0.1:8000/api/docs/

---

## License

MIT
