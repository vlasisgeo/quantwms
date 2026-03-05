// ── Auth ────────────────────────────────────────────────────────────────────
export interface TokenPair {
  access: string
  refresh: string
}

export interface AuthUser {
  id: number
  username: string
  email: string
  is_staff: boolean
}

// ── Core ─────────────────────────────────────────────────────────────────────
export interface Company {
  id: number
  code: string
  name: string
  created_at: string
}

export interface Warehouse {
  id: number
  code: string
  name: string
  company: number
  company_code?: string
  active: boolean
  created_at: string
}

export interface Section {
  id: number
  code: string
  name: string
  warehouse: number
  warehouse_code?: string
  active: boolean
}

export interface BinType {
  id: number
  name: string
  description: string
  active: boolean
}

export interface Bin {
  id: number
  location_code: string
  warehouse: number
  warehouse_code?: string
  section: number | null
  section_code?: string | null
  bin_type: number | null
  active: boolean
  note: string
}

// ── Inventory ─────────────────────────────────────────────────────────────────
export interface ItemCategory {
  id: number
  name: string
}

export interface Item {
  id: number
  sku: string
  name: string
  description: string
  category: number | null
  category_name?: string | null
  length_mm: number | null
  width_mm: number | null
  height_mm: number | null
  weight_grams: number | null
  fragile: boolean
  hazardous: boolean
  requires_refrigeration: boolean
  active: boolean
  created_at: string
}

export interface Lot {
  id: number
  item: number
  item_sku?: string
  lot_code: string
  expiry_date: string | null
  manufacture_date: string | null
}

export interface StockCategory {
  id: number
  code: string
  name: string
}

export interface Quant {
  id: number
  item: number
  item_sku?: string
  item_name?: string
  bin: number
  bin_location?: string
  bin_warehouse_code?: string
  lot: number | null
  lot_code?: string | null
  stock_category: number
  stock_category_code?: string
  owner: number
  owner_name?: string
  qty: number
  qty_reserved: number
  qty_available: number
  received_at: string
}

export interface Movement {
  id: number
  item: number
  item_sku?: string
  movement_type: string
  movement_type_display?: string
  qty: number
  warehouse: number
  warehouse_code?: string
  from_quant: number | null
  to_quant: number | null
  reference: string
  notes: string
  created_by: number | null
  created_by_username?: string | null
  created_at: string
}

// ── Orders ───────────────────────────────────────────────────────────────────
export interface DocumentLine {
  id: number
  document: number
  item: number
  item_sku?: string
  item_name?: string
  qty_requested: number
  qty_allocated: number
  qty_picked: number
  qty_remaining: number
  price: string | null
  discount_percent: string
  notes: string
  created_at: string
  updated_at: string
}

export interface Document {
  id: number
  doc_number: string
  doc_type: number
  status: number
  warehouse: number
  warehouse_code?: string
  warehouse_to: number | null
  warehouse_to_code?: string | null
  owner: number
  owner_name?: string
  erp_doc_number: string
  notes: string
  total_qty_requested: number
  total_qty_allocated: number
  total_qty_picked: number
  qty_remaining: number
  is_completed: boolean
  created_by: number | null
  created_by_username?: string | null
  lines: DocumentLine[]
  created_at: string
  updated_at: string
}

export interface Reservation {
  id: number
  line: number
  line_document_number?: string
  line_item_sku?: string
  quant: number
  quant_bin_location?: string
  qty: number
  qty_picked: number
  qty_remaining: number
  created_at: string
  updated_at: string
}

export interface FulfilmentLog {
  id: number
  document: number | null
  doc_number: string
  owner: number | null
  owner_name?: string | null
  status: 'PENDING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'
  requested_by: number | null
  requested_by_username?: string | null
  allocation_results: {
    allocated_lines: number[]
    partially_allocated_lines: { line_id: number; allocated: number; requested: number }[]
    unallocated_lines: number[]
  } | null
  error_message: string
  created_at: string
  updated_at: string
}

// ── ERP Connector ─────────────────────────────────────────────────────────────
export interface ERPIntegration {
  id: number
  name: string
  description: string
  company: number
  company_name?: string
  outbound_base_url: string
  default_warehouse: number | null
  default_warehouse_code?: string | null
  last_synced_at: string | null
  created_at: string
}

export interface InboundEvent {
  id: number
  integration: number
  integration_name?: string
  event_id: string | null
  event_type: string
  payload: Record<string, unknown>
  received_at: string
  processed: boolean
  attempts: number
  last_error: string
}

export interface Delivery {
  id: number
  integration: number
  integration_name?: string
  event_type: string
  payload: Record<string, unknown>
  status: 'PENDING' | 'SENT' | 'FAILED'
  attempts: number
  created_at: string
  sent_at: string | null
  last_error: string
}

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
