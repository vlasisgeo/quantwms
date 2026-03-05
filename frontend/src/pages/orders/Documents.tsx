import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { documentsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Table, Pagination } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { DOC_STATUS_LABELS, DOC_STATUS_COLORS, DOC_TYPE_LABELS, formatDate } from '@/lib/utils'

const PAGE_SIZE = 20

export default function Documents() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['documents', page, search, statusFilter],
    queryFn: () => documentsApi.list({
      page,
      search,
      page_size: PAGE_SIZE,
      ...(statusFilter ? { status: statusFilter } : {}),
    }),
    refetchInterval: 10_000,
  })

  const cancelMutation = useMutation({
    mutationFn: documentsApi.cancel,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
          <p className="mt-1 text-sm text-slate-500">{data?.count ?? 0} total orders</p>
        </div>
        <Button onClick={() => navigate('/orders/fulfil')}>
          <Plus className="h-4 w-4" /> New Order
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Documents</CardTitle>
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All statuses</option>
              {Object.entries(DOC_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search doc number…"
                className="h-9 w-56 rounded-lg border border-slate-200 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            data={data?.results ?? []}
            columns={[
              {
                key: 'doc_number', header: 'Document',
                render: (r) => (
                  <div>
                    <p className="font-mono font-medium text-slate-900">{r.doc_number}</p>
                    {r.erp_doc_number && <p className="text-xs text-slate-400">{r.erp_doc_number}</p>}
                  </div>
                ),
              },
              { key: 'doc_type', header: 'Type', render: (r) => DOC_TYPE_LABELS[r.doc_type] ?? r.doc_type },
              {
                key: 'status', header: 'Status',
                render: (r) => (
                  <Badge label={DOC_STATUS_LABELS[r.status] ?? r.status} className={DOC_STATUS_COLORS[r.status]} />
                ),
              },
              { key: 'warehouse_code', header: 'Warehouse' },
              { key: 'owner_name', header: 'Owner' },
              {
                key: 'qty', header: 'Qty',
                render: (r) => (
                  <span className="text-xs">
                    <span className="font-semibold">{r.total_qty_picked}</span>
                    <span className="text-slate-400">/{r.total_qty_requested}</span>
                  </span>
                ),
              },
              { key: 'created_at', header: 'Created', render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> },
              {
                key: 'actions', header: '',
                render: (r) => (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); navigate(`/orders/documents/${r.id}`) }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {r.status !== 80 && r.status !== 70 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); cancelMutation.mutate(r.id) }}
                        className="text-red-500 hover:bg-red-50"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}
