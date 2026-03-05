import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { deliveriesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Table, Pagination } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { DELIVERY_STATUS_COLORS, formatDate } from '@/lib/utils'
import type { Delivery } from '@/types'

const PAGE_SIZE = 20

export default function Deliveries() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [detail, setDetail] = useState<Delivery | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', page, statusFilter],
    queryFn: () => deliveriesApi.list({ page, page_size: PAGE_SIZE, ...(statusFilter ? { status: statusFilter } : {}) }),
  })

  const retryMutation = useMutation({
    mutationFn: deliveriesApi.retry,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deliveries'] }); setDetail(null) },
  })

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Outbound Deliveries</h1>
        <p className="mt-1 text-sm text-slate-500">Notifications sent back to eshop / ERP</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{data?.count ?? 0} Deliveries</CardTitle>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All statuses</option>
            {['PENDING', 'SENT', 'FAILED'].map((s) => <option key={s} value={s}>{s}</option>)}
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
              { key: 'event_type', header: 'Event', render: (r) => <span className="font-mono text-sm">{r.event_type}</span> },
              { key: 'integration_name', header: 'Integration' },
              {
                key: 'status', header: 'Status',
                render: (r) => <Badge label={r.status} className={DELIVERY_STATUS_COLORS[r.status]} />,
              },
              { key: 'attempts', header: 'Attempts' },
              { key: 'sent_at', header: 'Sent At', render: (r) => r.sent_at ? formatDate(r.sent_at) : '—' },
              { key: 'created_at', header: 'Created', render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> },
            ]}
          />
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </CardContent>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Delivery #${detail?.id} — ${detail?.event_type}`} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge label={detail.status} className={DELIVERY_STATUS_COLORS[detail.status]} />
              <span className="text-sm text-slate-500">{detail.integration_name} · {detail.attempts} attempts</span>
            </div>
            {detail.last_error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {detail.last_error}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Payload</p>
              <pre className="overflow-auto rounded-lg bg-slate-900 text-green-400 p-4 text-xs max-h-64">
                {JSON.stringify(detail.payload, null, 2)}
              </pre>
            </div>
            {detail.status !== 'SENT' && (
              <div className="flex justify-end">
                <Button loading={retryMutation.isPending} onClick={() => retryMutation.mutate(detail.id)}>
                  <RotateCcw className="h-4 w-4" /> Retry
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
