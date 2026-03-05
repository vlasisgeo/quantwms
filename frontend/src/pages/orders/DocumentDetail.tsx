import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, CheckCircle2, XCircle, Zap, AlertTriangle } from 'lucide-react'
import { documentsApi, reservationsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Table } from '@/components/ui/Table'
import { DOC_STATUS_LABELS, DOC_STATUS_COLORS, DOC_TYPE_LABELS, formatDate } from '@/lib/utils'

interface ReserveResult {
  allocated_lines: number[]
  partially_allocated_lines: { line_id: number; allocated: number; requested: number }[]
  unallocated_lines: number[]
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const docId = Number(id)
  const [reserveResult, setReserveResult] = useState<ReserveResult | null>(null)
  const [reserveError, setReserveError] = useState<string | null>(null)

  const { data: doc, isLoading } = useQuery({
    queryKey: ['document', docId],
    queryFn: () => documentsApi.get(docId),
  })

  const { data: picking } = useQuery({
    queryKey: ['picking', docId],
    queryFn: () => documentsApi.pickingList(docId),
    enabled: !!doc,
  })

  const reserveMutation = useMutation({
    mutationFn: () => documentsApi.reserve(docId),
    onSuccess: (data) => {
      setReserveResult(data.results)
      setReserveError(null)
      qc.invalidateQueries({ queryKey: ['document', docId] })
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setReserveError(err?.response?.data?.error ?? 'Reserve failed. Check stock levels.')
      setReserveResult(null)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => documentsApi.cancel(docId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document', docId] }); navigate('/orders/documents') },
  })

  const pickMutation = useMutation({
    mutationFn: (resId: number) => reservationsApi.pick(resId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document', docId] }),
  })

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" /></div>
  if (!doc) return <p className="p-8 text-slate-500">Document not found</p>

  const canReserve = ![70, 80].includes(doc.status)
  const canCancel = ![70, 80].includes(doc.status)
  const pickingData = (picking as { picking_list: { bin: string; items: { reservation_id: number; item_sku: string; qty_remaining: number }[] }[] } | undefined)?.picking_list ?? []

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => navigate('/orders/documents')} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{doc.doc_number}</h1>
            <Badge label={DOC_STATUS_LABELS[doc.status] ?? doc.status} className={DOC_STATUS_COLORS[doc.status]} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {DOC_TYPE_LABELS[doc.doc_type]} · {doc.warehouse_code} · {doc.owner_name}
          </p>
        </div>
        <div className="flex gap-2">
          {canReserve && (
            <Button variant="secondary" loading={reserveMutation.isPending} onClick={() => reserveMutation.mutate()}>
              <Zap className="h-4 w-4" /> Reserve All
            </Button>
          )}
          {canCancel && (
            <Button variant="danger" loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
              <XCircle className="h-4 w-4" /> Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Reserve feedback */}
      {reserveError && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{reserveError}</span>
          <button className="ml-auto text-red-400 hover:text-red-600" onClick={() => setReserveError(null)}>✕</button>
        </div>
      )}
      {reserveResult && (
        <div className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
          reserveResult.unallocated_lines.length > 0
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {reserveResult.allocated_lines.length} line{reserveResult.allocated_lines.length !== 1 ? 's' : ''} fully allocated
            {reserveResult.partially_allocated_lines.length > 0 && `, ${reserveResult.partially_allocated_lines.length} partial`}
            {reserveResult.unallocated_lines.length > 0 && `, ${reserveResult.unallocated_lines.length} unallocated (insufficient stock)`}
          </span>
          <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setReserveResult(null)}>✕</button>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Requested', value: doc.total_qty_requested },
          { label: 'Allocated', value: doc.total_qty_allocated, color: 'text-blue-600' },
          { label: 'Picked', value: doc.total_qty_picked, color: 'text-green-600' },
          { label: 'Remaining', value: doc.qty_remaining, color: 'text-amber-600' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="py-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className={`text-2xl font-bold ${color ?? 'text-slate-900'}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Lines */}
        <Card>
          <CardHeader><CardTitle>Order Lines</CardTitle><Package className="h-4 w-4 text-slate-400" /></CardHeader>
          <CardContent className="p-0">
            <Table
              keyExtractor={(r) => r.id}
              data={doc.lines}
              columns={[
                { key: 'item_sku', header: 'SKU', render: (r) => <span className="font-mono">{r.item_sku}</span> },
                { key: 'item_name', header: 'Name' },
                { key: 'qty_requested', header: 'Req' },
                { key: 'qty_allocated', header: 'Alloc', render: (r) => <span className="text-blue-600">{r.qty_allocated}</span> },
                { key: 'qty_picked', header: 'Picked', render: (r) => <span className="text-green-600">{r.qty_picked}</span> },
                {
                  key: 'status', header: '',
                  render: (r) => r.qty_picked >= r.qty_requested
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : null,
                },
              ]}
            />
          </CardContent>
        </Card>

        {/* Picking list */}
        <Card>
          <CardHeader><CardTitle>Picking List</CardTitle></CardHeader>
          <CardContent className="p-0">
            {pickingData.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No active reservations</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {pickingData.map((group) => (
                  <div key={group.bin} className="px-4 py-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">📍 {group.bin}</p>
                    {group.items.map((item) => (
                      <div key={item.reservation_id} className="flex items-center justify-between py-1">
                        <span className="text-sm font-mono text-slate-700">{item.item_sku}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold">× {item.qty_remaining}</span>
                          <Button
                            size="sm"
                            loading={pickMutation.isPending}
                            onClick={() => pickMutation.mutate(item.reservation_id)}
                          >
                            Pick
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Meta */}
      <Card className="mt-6">
        <CardContent className="grid grid-cols-2 gap-4 text-sm py-5">
          {[
            ['ERP Doc #', doc.erp_doc_number || '—'],
            ['Created by', doc.created_by_username ?? '—'],
            ['Created at', formatDate(doc.created_at)],
            ['Updated at', formatDate(doc.updated_at)],
            ['Notes', doc.notes || '—'],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-slate-900">{val}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
