import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Ruler } from 'lucide-react'
import { binTypesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import type { BinType } from '@/types'

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  description: z.string().optional(),
  x_mm: z.coerce.number().min(0).default(0),
  y_mm: z.coerce.number().min(0).default(0),
  z_mm: z.coerce.number().min(0).default(0),
  max_weight_grams: z.coerce.number().min(0).default(0),
  static: z.boolean().default(false),
  active: z.boolean().default(true),
})
type FormData = z.infer<typeof schema>

function volumeCm3(bt: BinType) {
  if (!bt.x_mm || !bt.y_mm || !bt.z_mm) return null
  return ((bt.x_mm * bt.y_mm * bt.z_mm) / 1_000_000).toFixed(1)
}

export default function BinTypes() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.is_staff ?? false

  const [editing, setEditing] = useState<BinType | null>(null)
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['bin-types'],
    queryFn: () => binTypesApi.list(),
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  function openCreate() {
    reset({ x_mm: 0, y_mm: 0, z_mm: 0, max_weight_grams: 0, static: false, active: true })
    setCreating(true)
  }

  function openEdit(bt: BinType) {
    reset({
      name: bt.name,
      description: bt.description,
      x_mm: bt.x_mm,
      y_mm: bt.y_mm,
      z_mm: bt.z_mm,
      max_weight_grams: bt.max_weight_grams,
      static: bt.static,
      active: bt.active,
    })
    setEditing(bt)
  }

  function closeModal() {
    setCreating(false)
    setEditing(null)
  }

  const createMutation = useMutation({
    mutationFn: binTypesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bin-types'] }); closeModal() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<BinType> }) => binTypesApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bin-types'] }); closeModal() },
  })

  const deleteMutation = useMutation({
    mutationFn: binTypesApi.destroy,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bin-types'] }); closeModal() },
  })

  function onSubmit(data: FormData) {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bin Types</h1>
          <p className="mt-1 text-sm text-slate-500">Reusable bin templates with dimensions and capacity</p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Bin Type
          </Button>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>All Bin Types</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r: BinType) => r.id}
            data={data?.results ?? []}
            onRowClick={isAdmin ? openEdit : undefined}
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (r: BinType) => <span className="font-medium text-slate-900">{r.name}</span>,
              },
              {
                key: 'description',
                header: 'Description',
                render: (r: BinType) => <span className="text-slate-500">{r.description || '—'}</span>,
              },
              {
                key: 'dimensions',
                header: 'Dimensions (mm)',
                render: (r: BinType) =>
                  r.x_mm || r.y_mm || r.z_mm ? (
                    <span className="font-mono text-sm">
                      {r.x_mm} × {r.y_mm} × {r.z_mm}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  ),
              },
              {
                key: 'volume',
                header: 'Volume',
                render: (r: BinType) => {
                  const v = volumeCm3(r)
                  return v ? (
                    <span className="text-sm text-slate-600">{v} L</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )
                },
              },
              {
                key: 'max_weight_grams',
                header: 'Max Weight',
                render: (r: BinType) =>
                  r.max_weight_grams ? (
                    <span className="text-sm text-slate-600">{(r.max_weight_grams / 1000).toFixed(1)} kg</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  ),
              },
              {
                key: 'static',
                header: 'Static',
                render: (r: BinType) => r.static ? <span className="text-xs font-medium text-blue-600">Static</span> : <span className="text-slate-300">—</span>,
              },
              {
                key: 'active',
                header: 'Active',
                render: (r: BinType) => r.active ? '✅' : '—',
              },
            ]}
          />
        </CardContent>
      </Card>

      <Modal
        open={creating || !!editing}
        onClose={closeModal}
        title={editing ? `Edit: ${editing.name}` : 'New Bin Type'}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label="Name" id="name" error={errors.name?.message} {...register('name')} />
          <Input label="Description" id="description" {...register('description')} />

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Ruler className="h-4 w-4 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Internal Dimensions (mm)</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Width (X)" id="x_mm" type="number" error={errors.x_mm?.message} {...register('x_mm')} />
              <Input label="Depth (Y)" id="y_mm" type="number" error={errors.y_mm?.message} {...register('y_mm')} />
              <Input label="Height (Z)" id="z_mm" type="number" error={errors.z_mm?.message} {...register('z_mm')} />
            </div>
          </div>

          <Input
            label="Max Weight (grams)"
            id="max_weight_grams"
            type="number"
            error={errors.max_weight_grams?.message}
            {...register('max_weight_grams')}
          />

          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" className="rounded" {...register('static')} />
              Static (fixed location, not movable)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" className="rounded" {...register('active')} />
              Active
            </label>
          </div>

          {(createMutation.isError || updateMutation.isError) && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">Save failed</p>
          )}

          <div className="flex items-center justify-between pt-2">
            {editing && (
              <Button
                type="button"
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(editing.id)}
              >
                Delete
              </Button>
            )}
            <div className={`flex gap-3 ${editing ? '' : 'ml-auto'}`}>
              <Button type="button" variant="secondary" onClick={closeModal}>Cancel</Button>
              <Button type="submit" loading={isPending}>{editing ? 'Save' : 'Create'}</Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
