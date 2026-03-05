import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Send, BarChart3 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { erpIntegrationsApi, companiesApi, warehousesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import type { ERPIntegration } from '@/types'

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  company: z.coerce.number().min(1),
  outbound_base_url: z.string().url().or(z.literal('')).optional(),
  default_warehouse: z.coerce.number().optional().nullable(),
})
type FormData = z.infer<typeof schema>

export default function Integrations() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | ERPIntegration>(null)
  const [syncResult, setSyncResult] = useState<{ id: number; message: string } | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['erp-integrations'], queryFn: () => erpIntegrationsApi.list() })
  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() })
  const { data: warehouses } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() })

  const createMutation = useMutation({
    mutationFn: erpIntegrationsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['erp-integrations'] }); setModal(null) },
  })
  const syncMutation = useMutation({
    mutationFn: erpIntegrationsApi.syncOrders,
    onSuccess: (data, id) => setSyncResult({ id, message: `Synced ${(data as { orders_ingested: number }).orders_ingested} orders` }),
  })
  const pushMutation = useMutation({
    mutationFn: erpIntegrationsApi.pushInventory,
    onSuccess: (data, id) => setSyncResult({ id, message: `Queued snapshot: ${(data as { quants_included: number }).quants_included} quants` }),
  })
  const sendMutation = useMutation({
    mutationFn: erpIntegrationsApi.sendPending,
    onSuccess: (data, id) => {
      const d = data as { sent: number; failed: number }
      setSyncResult({ id, message: `Sent ${d.sent}, failed ${d.failed}` })
    },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  function openCreate() { reset({ name: '', description: '', company: undefined as unknown as number }); setModal('create') }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ERP Integrations</h1>
          <p className="mt-1 text-sm text-slate-500">Connect eshops and ERP systems</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New Integration</Button>
      </div>

      {syncResult && (
        <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700 flex items-center justify-between">
          {syncResult.message}
          <button onClick={() => setSyncResult(null)} className="text-xs underline">dismiss</button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>All Integrations</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            data={data?.results ?? []}
            columns={[
              { key: 'name', header: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'company_name', header: 'Company' },
              { key: 'outbound_base_url', header: 'Eshop URL', render: (r) => r.outbound_base_url || '—' },
              { key: 'last_synced_at', header: 'Last Sync', render: (r) => formatDate(r.last_synced_at) },
              {
                key: 'actions', header: 'Actions',
                render: (r) => (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" loading={syncMutation.isPending} onClick={() => syncMutation.mutate(r.id)} title="Pull orders">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" loading={pushMutation.isPending} onClick={() => pushMutation.mutate(r.id)} title="Push inventory">
                      <BarChart3 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" loading={sendMutation.isPending} onClick={() => sendMutation.mutate(r.id)} title="Send pending deliveries">
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} title="New ERP Integration">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
          <Input label="Name" error={errors.name?.message} {...register('name')} />
          <Textarea label="Description" {...register('description')} />
          <Select label="Company" error={errors.company?.message} {...register('company')}>
            <option value="">Select…</option>
            {companies?.results.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Input label="Eshop Base URL" placeholder="https://myshop.com/api/wms" {...register('outbound_base_url')} />
          <Select label="Default Warehouse" {...register('default_warehouse')}>
            <option value="">None</option>
            {warehouses?.results.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
          </Select>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
