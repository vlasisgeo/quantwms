import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { sectionsApi, warehousesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import type { Section } from '@/types'

const schema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  warehouse: z.coerce.number().min(1, 'Select a warehouse'),
  active: z.boolean().optional(),
})
type FormData = z.infer<typeof schema>

export default function Sections() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | Section>(null)
  const [warehouseFilter, setWarehouseFilter] = useState('')

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehousesApi.list(),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['sections', warehouseFilter],
    queryFn: () => sectionsApi.list(warehouseFilter ? { warehouse: warehouseFilter } : undefined),
  })

  const createMutation = useMutation({
    mutationFn: sectionsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sections'] }); setModal(null) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: Partial<Section> & { id: number }) => sectionsApi.update(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sections'] }); setModal(null) },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  function openCreate() {
    reset({ code: '', name: '', warehouse: undefined as unknown as number, active: true })
    setModal('create')
  }

  function openEdit(s: Section) {
    reset({ code: s.code, name: s.name, warehouse: s.warehouse, active: s.active })
    setModal(s)
  }

  function onSubmit(d: FormData) {
    if (modal === 'create') {
      createMutation.mutate(d)
    } else if (modal && typeof modal === 'object') {
      updateMutation.mutate({ id: modal.id, ...d })
    }
  }

  const isEdit = modal && typeof modal === 'object'

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sections</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data?.count ?? 0} sections across all warehouses
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> New Section
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Sections</CardTitle>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All warehouses</option>
            {warehouses?.results.map((w) => (
              <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            onRowClick={openEdit}
            data={data?.results ?? []}
            columns={[
              {
                key: 'code',
                header: 'Code',
                render: (r) => <span className="font-mono font-medium">{r.code}</span>,
              },
              { key: 'name', header: 'Name' },
              { key: 'warehouse_code', header: 'Warehouse' },
              {
                key: 'active',
                header: 'Status',
                render: (r) => (
                  <Badge
                    label={r.active ? 'Active' : 'Inactive'}
                    className={r.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}
                  />
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={isEdit ? 'Edit Section' : 'New Section'}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Code"
              id="code"
              placeholder="A"
              error={errors.code?.message}
              {...register('code')}
            />
            <Input
              label="Name"
              id="name"
              placeholder="Aisle A"
              error={errors.name?.message}
              {...register('name')}
            />
          </div>

          <Select
            label="Warehouse"
            id="warehouse"
            error={errors.warehouse?.message}
            {...register('warehouse')}
          >
            <option value="">Select warehouse…</option>
            {warehouses?.results.map((w) => (
              <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
            ))}
          </Select>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" {...register('active')} className="rounded" />
            Active
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
