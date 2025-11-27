# QuantWMS API Quick Reference

## Base URL
```
http://127.0.0.1:8000/api/
```

## Authentication
```bash
POST /auth/token/
{
  "username": "your_user",
  "password": "your_pass"
}
```
Use returned `access` token in all requests:
```
Authorization: Bearer <access_token>
```

---

## Core Endpoints

### Companies
```
GET    /companies/           # List all
POST   /companies/           # Create
GET    /companies/{id}/      # Detail
PUT    /companies/{id}/      # Update
DELETE /companies/{id}/      # Delete
```

### Warehouses
```
GET    /warehouses/          # List (filtered by user access)
POST   /warehouses/          # Create
GET    /warehouses/{id}/     # Detail
PUT    /warehouses/{id}/     # Update
DELETE /warehouses/{id}/     # Delete
```

### Sections
```
GET    /sections/
POST   /sections/
GET    /sections/{id}/
```

### Bin Types
```
GET    /bin-types/
POST   /bin-types/
GET    /bin-types/{id}/
```

### Bins
```
GET    /bins/                        # List
POST   /bins/                        # Create
GET    /bins/{id}/                   # Detail
GET    /bins/{id}/inventory/         # Get items in bin
PUT    /bins/{id}/                   # Update
DELETE /bins/{id}/                   # Delete
```

---

## Inventory Endpoints

### Items
```
GET    /items/               # List
POST   /items/               # Create (SKU, name, dimensions)
GET    /items/{id}/          # Detail
```

### Lots (Batches)
```
GET    /lots/                # List
POST   /lots/                # Create (item, lot_code, expiry_date)
GET    /lots/{id}/           # Detail
```

### Stock Categories
```
GET    /stock-categories/    # Read-only (UNRESTRICTED, BLOCKED, etc.)
```

### Quants (Inventory Units)
```
GET    /quants/              # List (filter by item, bin, owner)
GET    /quants/{id}/         # Detail

# Special endpoints:
POST   /quants/receive_goods/        # Receive/add to inventory
POST   /quants/transfer/             # Transfer between bins
GET    /quants/by_item/?item_id=...  # Get snapshot by item
```

### Movements (Audit Log)
```
GET    /movements/           # List (filter by item, warehouse, type)
GET    /movements/{id}/      # Detail (READ-ONLY)
```

---

## Order Endpoints

### Documents
```
GET    /documents/                   # List (filter by status, warehouse)
GET    /documents/{id}/              # Detail (includes lines & reservations)

# Special endpoints:
POST   /documents/create_document/   # Create new order/transfer/receipt
POST   /documents/{id}/add_line/     # Add item line to document
POST   /documents/{id}/reserve/      # Allocate all lines (FIFO or FEFO)
POST   /documents/{id}/cancel/       # Cancel and release reservations
```

### Document Lines
```
GET    /document-lines/              # List (filter by document, item)
GET    /document-lines/{id}/         # Detail
```

### Reservations
```
GET    /reservations/                # List (filter by line, quant)
GET    /reservations/{id}/           # Detail

# Special endpoints:
POST   /reservations/{id}/pick/      # Execute pick
POST   /reservations/{id}/unreserve/ # Release allocation
```

---

## Common Workflows

### Receive Goods
```bash
POST /quants/receive_goods/
{
  "bin_id": 1,
  "item_sku": "SKU-001",
  "qty": 100,
  "lot_code": "BATCH-001",
  "stock_category": "UNRESTRICTED",
  "owner_id": 1
}
```

### Check Stock Level
```bash
GET /quants/by_item/?item_id=1&warehouse_id=1
```

### Create & Fulfill Order (5 steps)
```bash
# 1. Create
POST /documents/create_document/
{
  "doc_number": "SO-001",
  "doc_type": 100,
  "warehouse_id": 1,
  "owner_id": 1
}

# 2. Add line
POST /documents/{id}/add_line/
{
  "item_sku": "SKU-001",
  "qty_requested": 50
}

# 3. Reserve
POST /documents/{id}/reserve/
{"strategy": "FIFO"}

# 4. Pick
POST /reservations/{id}/pick/
{"qty": 50}

# 5. Verify
GET /documents/{id}/
```

### Transfer Between Bins
```bash
POST /quants/transfer/
{
  "from_quant_id": 5,
  "to_quant_id": 6,
  "qty": 50
}
```

### Audit Trail
```bash
GET /movements/?warehouse=1&movement_type=OUTBOUND
```

---

## Query Parameters

### Pagination
```
?page=1
?page_size=25
```

### Filtering
```
/warehouses/?company=1&active=true
/items/?category=1
/quants/?item=1&bin=5&owner=1&stock_category=UNRESTRICTED
/movements/?warehouse=1&movement_type=OUTBOUND&created_at__gte=2025-01-01
/documents/?warehouse=1&status=40
```

### Ordering
```
?ordering=-created_at
?ordering=name
```

### Searching
```
/items/?search=laptop
```

---

## Response Codes

| Code | Meaning |
|------|---------|
| 200  | OK - Success |
| 201  | Created - Resource created |
| 400  | Bad Request - Invalid input |
| 401  | Unauthorized - Auth required or token expired |
| 403  | Forbidden - No permission |
| 404  | Not Found - Resource doesn't exist |
| 409  | Conflict - Can't allocate (insufficient qty, duplicate, etc.) |
| 500  | Server Error |

---

## Error Handling

All errors return JSON:
```json
{
  "error": "descriptive message",
  "detail": "more info"
}
```

Example:
```json
{
  "error": "Transfer failed: insufficient available quantity"
}
```

---

## Tips

1. **Always get a fresh token** if you get 401
2. **Use filters** to limit results: `?warehouse=1&active=true`
3. **Check by_item endpoint** to see all bins holding an item
4. **Use FEFO strategy** if lots have expiry dates
5. **Verify document completion** with `is_completed` field
6. **Check Movement log** for audit trail
7. **Use bin inventory endpoint** to see what's in a specific location

---

## Swagger UI

Full interactive documentation at:
```
http://127.0.0.1:8000/api/docs/
```

Test all endpoints directly from the browser!
