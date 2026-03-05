import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { warehousesApi, companiesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import type { Warehouse } from '@/types'

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  company: z.coerce.number().min(1),
  active: z.boolean().optional(),
})
type FormData = z.infer<typeof schema>

export default function Warehouses() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | Warehouse>(null)

  const { data, isLoading } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() })
  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() })

  const createMutation = useMutation({
    mutationFn: warehousesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); setModal(null) },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: Partial<Warehouse> & { id: number }) => warehousesApi.update(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); setModal(null) },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  function openCreate() { reset({ code: '', name: '', active: true }); setModal('create') }
  function openEdit(w: Warehouse) { reset({ code: w.code, name: w.name, company: w.company, active: w.active }); setModal(w) }

  function onSubmit(d: FormData) {
    if (modal === 'create') createMutation.mutate(d)
    else if (modal && typeof modal === 'object') updateMutation.mutate({ id: modal.id, ...d })
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Warehouses</h1>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New Warehouse</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>{data?.count ?? 0} Warehouses</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            onRowClick={openEdit}
            data={data?.results ?? []}
            columns={[
              { key: 'code', header: 'Code', render: (r) => <span className="font-mono font-medium">{r.code}</span> },
              { key: 'name', header: 'Name' },
              { key: 'company_code', header: 'Company' },
              {
                key: 'active', header: 'Status',
                render: (r) => <Badge label={r.active ? 'Active' : 'Inactive'} className={r.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'} />,
              },
            ]}
          />
        </CardContent>
      </Card>
      <Modal open={!!modal} onClose={() => setModal(null)} title={typeof modal === 'object' ? 'Edit Warehouse' : 'New Warehouse'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Code" error={errors.code?.message} {...register('code')} />
            <Input label="Name" error={errors.name?.message} {...register('name')} />
          </div>
          <Select label="Company" error={errors.company?.message} {...register('company')}>
            <option value="">Select…</option>
            {companies?.results.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('active')} className="rounded" /> Active
          </label>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending || updateMutation.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
