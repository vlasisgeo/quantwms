import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { movementsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Table, Pagination } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils'

const PAGE_SIZE = 25

const TYPE_COLORS: Record<string, string> = {
  inbound: 'bg-green-100 text-green-700',
  outbound: 'bg-red-100 text-red-700',
  transfer: 'bg-blue-100 text-blue-700',
  adjustment: 'bg-purple-100 text-purple-700',
  reserved: 'bg-amber-100 text-amber-700',
}

export default function Movements() {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['movements', page],
    queryFn: () => movementsApi.list({ page, page_size: PAGE_SIZE }),
  })

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Movements</h1>
        <p className="mt-1 text-sm text-slate-500">Immutable inventory audit log</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Movements</CardTitle>
          <span className="text-sm text-slate-400">{data?.count ?? 0} records</span>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            data={data?.results ?? []}
            columns={[
              { key: 'id', header: '#', render: (r) => <span className="text-slate-400 font-mono text-xs">#{r.id}</span> },
              {
                key: 'movement_type', header: 'Type',
                render: (r) => (
                  <Badge
                    label={r.movement_type_display ?? r.movement_type}
                    className={TYPE_COLORS[r.movement_type.toLowerCase()] ?? 'bg-slate-100 text-slate-600'}
                  />
                ),
              },
              { key: 'item_sku', header: 'SKU', render: (r) => <span className="font-mono">{r.item_sku}</span> },
              { key: 'qty', header: 'Qty', render: (r) => <span className="font-semibold">{r.qty}</span> },
              { key: 'warehouse_code', header: 'Warehouse' },
              { key: 'reference', header: 'Reference', render: (r) => <span className="text-slate-500 text-xs">{r.reference}</span> },
              { key: 'created_by_username', header: 'By', render: (r) => r.created_by_username ?? '—' },
              { key: 'created_at', header: 'Date', render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> },
            ]}
          />
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}
