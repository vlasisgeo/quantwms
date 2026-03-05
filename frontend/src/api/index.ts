import api from '@/lib/api'
import type {
  Company, Warehouse, Section, Bin, BinType,
  Item, ItemCategory, Lot, StockCategory, Quant, Movement,
  Document, DocumentLine, Reservation, FulfilmentLog,
  ERPIntegration, InboundEvent, Delivery,
  PaginatedResponse,
} from '@/types'

// ── helpers ──────────────────────────────────────────────────────────────────
type Params = Record<string, string | number | boolean | undefined>

function list<T>(url: string, params?: Params) {
  return api.get<PaginatedResponse<T>>(url, { params }).then((r) => r.data)
}
function get<T>(url: string) {
  return api.get<T>(url).then((r) => r.data)
}
function post<T>(url: string, data?: unknown) {
  return api.post<T>(url, data).then((r) => r.data)
}
function patch<T>(url: string, data?: unknown) {
  return api.patch<T>(url, data).then((r) => r.data)
}
function del(url: string) {
  return api.delete(url)
}

// ── Core ─────────────────────────────────────────────────────────────────────
export const companiesApi = {
  list: (params?: Params) => list<Company>('/companies/', params),
  get: (id: number) => get<Company>(`/companies/${id}/`),
  create: (data: Partial<Company>) => post<Company>('/companies/', data),
  update: (id: number, data: Partial<Company>) => patch<Company>(`/companies/${id}/`, data),
  delete: (id: number) => del(`/companies/${id}/`),
}

export const warehousesApi = {
  list: (params?: Params) => list<Warehouse>('/warehouses/', params),
  get: (id: number) => get<Warehouse>(`/warehouses/${id}/`),
  create: (data: Partial<Warehouse>) => post<Warehouse>('/warehouses/', data),
  update: (id: number, data: Partial<Warehouse>) => patch<Warehouse>(`/warehouses/${id}/`, data),
}

export const sectionsApi = {
  list: (params?: Params) => list<Section>('/sections/', params),
  create: (data: Partial<Section>) => post<Section>('/sections/', data),
  update: (id: number, data: Partial<Section>) => patch<Section>(`/sections/${id}/`, data),
}

export const binsApi = {
  list: (params?: Params) => list<Bin>('/bins/', params),
  get: (id: number) => get<Bin>(`/bins/${id}/`),
  createLocation: (data: unknown) => post<Bin>('/bins/create-location/', data),
  massCreate: (data: unknown) => post<unknown>('/bins/mass-create-dexion/', data),
  inventory: (id: number) => get<unknown>(`/bins/${id}/inventory/`),
  patch: (id: number, data: Partial<Bin>) => patch<Bin>(`/bins/${id}/`, data),
}

export const binTypesApi = {
  list: () => list<BinType>('/bin-types/'),
}

// ── Inventory ─────────────────────────────────────────────────────────────────
export const itemsApi = {
  list: (params?: Params) => list<Item>('/items/', params),
  get: (id: number) => get<Item>(`/items/${id}/`),
  create: (data: Partial<Item>) => post<Item>('/items/', data),
  update: (id: number, data: Partial<Item>) => patch<Item>(`/items/${id}/`, data),
}

export const itemCategoriesApi = {
  list: () => list<ItemCategory>('/item-categories/'),
}

export const lotsApi = {
  list: (params?: Params) => list<Lot>('/lots/', params),
}

export const stockCategoriesApi = {
  list: () => list<StockCategory>('/stock-categories/'),
  create: (data: Partial<StockCategory>) => post<StockCategory>('/stock-categories/', data),
  update: (code: string, data: Partial<StockCategory>) => patch<StockCategory>(`/stock-categories/${code}/`, data),
  destroy: (code: string) => del(`/stock-categories/${code}/`),
}

export const quantsApi = {
  list: (params?: Params) => list<Quant>('/quants/', params),
  get: (id: number) => get<Quant>(`/quants/${id}/`),
  receiveGoods: (data: unknown) => post<Quant>('/quants/receive_goods/', data),
  transfer: (data: unknown) => post<unknown>('/quants/transfer/', data),
  transferToBin: (data: unknown) => post<unknown>('/quants/transfer_to_bin/', data),
  byItem: (itemId: number, warehouseId?: number) =>
    get<unknown>(`/quants/by_item/?item_id=${itemId}${warehouseId ? `&warehouse_id=${warehouseId}` : ''}`),
}

export const movementsApi = {
  list: (params?: Params) => list<Movement>('/movements/', params),
}

// ── Orders ───────────────────────────────────────────────────────────────────
export const documentsApi = {
  list: (params?: Params) => list<Document>('/documents/', params),
  get: (id: number) => get<Document>(`/documents/${id}/`),
  create: (data: unknown) => post<Document>('/documents/', data),
  fulfil: (data: unknown) => post<{ document: Document; allocation?: unknown; log_id: number }>('/documents/fulfil/', data),
  addLine: (id: number, data: unknown) => post<DocumentLine>(`/documents/${id}/add_line/`, data),
  reserve: (id: number, strategy?: string) =>
    post<{ status: string; results: { allocated_lines: number[]; partially_allocated_lines: { line_id: number; allocated: number; requested: number }[]; unallocated_lines: number[] }; document: unknown }>(`/documents/${id}/reserve/`, { strategy: strategy ?? 'FIFO' }),
  cancel: (id: number) => post<unknown>(`/documents/${id}/cancel/`),
  pickingList: (id: number) => get<unknown>(`/documents/${id}/picking_list/`),
}

export const reservationsApi = {
  list: (params?: Params) => list<Reservation>('/reservations/', params),
  pick: (id: number, qty?: number) => post<unknown>(`/reservations/${id}/pick/`, { qty }),
  unreserve: (id: number) => post<unknown>(`/reservations/${id}/unreserve/`),
}

export const documentLinesApi = {
  list: (params?: Params) => list<DocumentLine>('/document-lines/', params),
}

export const fulfilmentLogsApi = {
  list: (params?: Params) => list<FulfilmentLog>('/fulfilment-logs/', params),
  get: (id: number) => get<FulfilmentLog>(`/fulfilment-logs/${id}/`),
}

// ── ERP Connector ─────────────────────────────────────────────────────────────
export const erpIntegrationsApi = {
  list: (params?: Params) => list<ERPIntegration>('/erp/integrations/', params),
  get: (id: number) => get<ERPIntegration>(`/erp/integrations/${id}/`),
  create: (data: Partial<ERPIntegration>) => post<ERPIntegration>('/erp/integrations/', data),
  update: (id: number, data: Partial<ERPIntegration>) =>
    patch<ERPIntegration>(`/erp/integrations/${id}/`, data),
  syncOrders: (id: number) => post<unknown>(`/erp/integrations/${id}/sync_orders/`),
  pushInventory: (id: number) => post<unknown>(`/erp/integrations/${id}/push_inventory/`),
  sendPending: (id: number) => post<unknown>(`/erp/integrations/${id}/send_pending/`),
}

export const inboundEventsApi = {
  list: (params?: Params) => list<InboundEvent>('/erp/inbound-events/', params),
  reprocess: (id: number) => post<unknown>(`/erp/inbound-events/${id}/reprocess/`),
}

export const deliveriesApi = {
  list: (params?: Params) => list<Delivery>('/erp/deliveries/', params),
  retry: (id: number) => post<unknown>(`/erp/deliveries/${id}/retry/`),
}
