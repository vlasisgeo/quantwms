import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fulfilmentLogsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Table, Pagination } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { LOG_STATUS_COLORS, formatDate } from '@/lib/utils'
import type { FulfilmentLog } from '@/types'

const PAGE_SIZE = 20

export default function FulfilmentLogs() {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [detail, setDetail] = useState<FulfilmentLog | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['fulfilment-logs', page, statusFilter],
    queryFn: () => fulfilmentLogsApi.list({ page, page_size: PAGE_SIZE, ...(statusFilter ? { status: statusFilter } : {}) }),
  })

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Fulfilment Logs</h1>
        <p className="mt-1 text-sm text-slate-500">Every order creation attempt — success, partial, or failure</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Logs</CardTitle>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All statuses</option>
            {['PENDING', 'SUCCESS', 'PARTIAL', 'FAILED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            onRowClick={setDetail}
            data={data?.results ?? []}
            columns={[
              { key: 'id', header: '#', render: (r) => <span className="font-mono text-xs text-slate-400">#{r.id}</span> },
              { key: 'doc_number', header: 'Doc Number', render: (r) => <span className="font-mono font-medium">{r.doc_number}</span> },
              {
                key: 'status', header: 'Status',
                render: (r) => <Badge label={r.status} className={LOG_STATUS_COLORS[r.status]} />,
              },
              { key: 'owner_name', header: 'Owner', render: (r) => r.owner_name ?? '—' },
              { key: 'requested_by_username', header: 'By', render: (r) => r.requested_by_username ?? '—' },
              {
                key: 'error_message', header: 'Error',
                render: (r) => r.error_message ? (
                  <span className="text-xs text-red-500 truncate max-w-xs block">{r.error_message}</span>
                ) : <span className="text-slate-300">—</span>,
              },
              { key: 'created_at', header: 'Time', render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> },
            ]}
          />
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </CardContent>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Log #${detail?.id} — ${detail?.doc_number}`} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge label={detail.status} className={LOG_STATUS_COLORS[detail.status]} />
              <span className="text-sm text-slate-500">Owner: {detail.owner_name}</span>
            </div>
            {detail.error_message && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {detail.error_message}
              </div>
            )}
            {detail.allocation_results && (
              <div className="rounded-lg bg-slate-50 p-4 text-sm space-y-2">
                <p className="font-semibold text-slate-700">Allocation Results</p>
                <p>✅ Allocated lines: {detail.allocation_results.allocated_lines.length}</p>
                <p>⚠️ Partially allocated: {detail.allocation_results.partially_allocated_lines.length}</p>
                <p>❌ Unallocated: {detail.allocation_results.unallocated_lines.length}</p>
                {detail.allocation_results.partially_allocated_lines.map((p) => (
                  <div key={p.line_id} className="text-xs text-slate-500 pl-4">
                    Line {p.line_id}: {p.allocated}/{p.requested} allocated
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-400">{formatDate(detail.created_at)}</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
