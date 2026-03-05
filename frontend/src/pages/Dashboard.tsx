import { useQuery } from '@tanstack/react-query'
import { Package, Boxes, FileText, AlertTriangle, TrendingUp, Clock } from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { itemsApi, quantsApi, documentsApi, movementsApi, fulfilmentLogsApi } from '@/api'
import { DOC_STATUS_LABELS, DOC_STATUS_COLORS, formatDate } from '@/lib/utils'

export default function Dashboard() {
  const { data: items } = useQuery({ queryKey: ['items-count'], queryFn: () => itemsApi.list({ page_size: 1 }) })
  const { data: quants } = useQuery({ queryKey: ['quants-count'], queryFn: () => quantsApi.list({ page_size: 1 }) })
  const { data: pending } = useQuery({
    queryKey: ['pending-docs'],
    queryFn: () => documentsApi.list({ status: 20, page_size: 5 }),
  })
  const { data: recentDocs } = useQuery({
    queryKey: ['recent-docs'],
    queryFn: () => documentsApi.list({ page_size: 8, ordering: '-created_at' }),
  })
  const { data: recentMovements } = useQuery({
    queryKey: ['recent-movements'],
    queryFn: () => movementsApi.list({ page_size: 8 }),
  })
  const { data: failedLogs } = useQuery({
    queryKey: ['failed-logs'],
    queryFn: () => fulfilmentLogsApi.list({ status: 'FAILED', page_size: 5 }),
  })

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Warehouse overview</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Total Items"
          value={items?.count ?? '—'}
          subtitle="SKUs in catalogue"
          icon={<Package className="h-6 w-6" />}
          color="indigo"
        />
        <StatCard
          title="Stock Quants"
          value={quants?.count ?? '—'}
          subtitle="Active stock records"
          icon={<Boxes className="h-6 w-6" />}
          color="emerald"
        />
        <StatCard
          title="Pending Orders"
          value={pending?.count ?? '—'}
          subtitle="Awaiting allocation"
          icon={<Clock className="h-6 w-6" />}
          color="amber"
        />
        <StatCard
          title="Failed Fulfilments"
          value={failedLogs?.count ?? '—'}
          subtitle="Need attention"
          icon={<AlertTriangle className="h-6 w-6" />}
          color="rose"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent orders */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
            <TrendingUp className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent className="p-0">
            {recentDocs?.results.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No orders yet</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {recentDocs?.results.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{doc.doc_number}</p>
                      <p className="text-xs text-slate-400">{doc.owner_name} · {formatDate(doc.created_at)}</p>
                    </div>
                    <Badge
                      label={DOC_STATUS_LABELS[doc.status] ?? doc.status}
                      className={DOC_STATUS_COLORS[doc.status]}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent movements */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Movements</CardTitle>
            <FileText className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent className="p-0">
            {recentMovements?.results.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No movements yet</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {recentMovements?.results.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {m.item_sku} <span className="font-normal text-slate-500">× {m.qty}</span>
                      </p>
                      <p className="text-xs text-slate-400">
                        {m.movement_type_display ?? m.movement_type} · {m.warehouse_code}
                      </p>
                    </div>
                    <p className="text-xs text-slate-400">{formatDate(m.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
