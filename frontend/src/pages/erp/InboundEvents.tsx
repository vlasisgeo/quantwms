import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inboundEventsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Table, Pagination } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import type { InboundEvent } from '@/types'

const PAGE_SIZE = 20

export default function InboundEvents() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [processedFilter, setProcessedFilter] = useState('')
  const [detail, setDetail] = useState<InboundEvent | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['inbound-events', page, processedFilter],
    queryFn: () => inboundEventsApi.list({
      page,
      page_size: PAGE_SIZE,
      ...(processedFilter !== '' ? { processed: processedFilter } : {}),
    }),
  })

  const reprocessMutation = useMutation({
    mutationFn: inboundEventsApi.reprocess,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inbound-events'] }); setDetail(null) },
  })

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Inbound Events</h1>
        <p className="mt-1 text-sm text-slate-500">Events received from eshop / ERP systems</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{data?.count ?? 0} Events</CardTitle>
          <select
            value={processedFilter}
            onChange={(e) => { setProcessedFilter(e.target.value); setPage(1) }}
            className="h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All</option>
            <option value="false">Unprocessed</option>
            <option value="true">Processed</option>
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
              { key: 'event_type', header: 'Type', render: (r) => <span className="font-mono text-sm">{r.event_type}</span> },
              { key: 'event_id', header: 'Event ID', render: (r) => <span className="font-mono text-xs">{r.event_id ?? '—'}</span> },
              { key: 'integration_name', header: 'Integration' },
              {
                key: 'processed', header: 'Status',
                render: (r) => (
                  <Badge
                    label={r.processed ? 'Processed' : r.attempts > 0 ? 'Failed' : 'Pending'}
                    className={r.processed ? 'bg-green-100 text-green-700' : r.attempts > 0 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}
                  />
                ),
              },
              { key: 'attempts', header: 'Attempts' },
              { key: 'received_at', header: 'Received', render: (r) => <span className="text-xs">{formatDate(r.received_at)}</span> },
            ]}
          />
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </CardContent>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Event #${detail?.id} — ${detail?.event_type}`} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge label={detail.processed ? 'Processed' : 'Unprocessed'} className={detail.processed ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'} />
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
            {!detail.processed && (
              <div className="flex justify-end">
                <Button loading={reprocessMutation.isPending} onClick={() => reprocessMutation.mutate(detail.id)}>
                  Reprocess
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
