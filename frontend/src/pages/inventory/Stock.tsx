import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { quantsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Table, Pagination } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import type { Quant } from '@/types'

const PAGE_SIZE = 25

export default function Stock() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<Quant | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['quants', page, search],
    queryFn: () => quantsApi.list({ page, search, page_size: PAGE_SIZE }),
  })

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Stock</h1>
        <p className="mt-1 text-sm text-slate-500">{data?.count ?? 0} quant records</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Quants</CardTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search SKU or bin…"
              className="h-9 w-64 rounded-lg border border-slate-200 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            onRowClick={setDetail}
            data={data?.results ?? []}
            columns={[
              { key: 'item_sku', header: 'SKU', render: (r) => <span className="font-mono font-medium">{r.item_sku}</span> },
              { key: 'item_name', header: 'Name' },
              { key: 'bin_location', header: 'Bin' },
              { key: 'bin_warehouse_code', header: 'Warehouse' },
              { key: 'lot_code', header: 'Lot', render: (r) => r.lot_code ?? '—' },
              { key: 'qty', header: 'Qty', render: (r) => <span className="font-semibold">{r.qty}</span> },
              { key: 'qty_reserved', header: 'Reserved', render: (r) => <span className="text-amber-600">{r.qty_reserved}</span> },
              { key: 'qty_available', header: 'Available', render: (r) => <span className="text-emerald-600 font-semibold">{r.qty_available}</span> },
              { key: 'owner_name', header: 'Owner' },
            ]}
          />
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </CardContent>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Quant Detail">
        {detail && (
          <div className="space-y-3 text-sm">
            {([
              ['Item SKU', detail.item_sku],
              ['Bin', detail.bin_location],
              ['Warehouse', detail.bin_warehouse_code],
              ['Lot', detail.lot_code ?? '—'],
              ['Stock Category', detail.stock_category_code],
              ['Owner', detail.owner_name],
              ['Qty (physical)', detail.qty],
              ['Reserved', detail.qty_reserved],
              ['Available', detail.qty_available],
            ] as [string, unknown][]).map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-slate-50 pb-2">
                <span className="text-slate-500">{label}</span>
                <span className="font-medium text-slate-900">{String(value ?? '—')}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
