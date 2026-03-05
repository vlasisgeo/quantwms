import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { itemsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table, Pagination } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import type { Item } from '@/types'

const PAGE_SIZE = 20

const schema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  weight_grams: z.coerce.number().nullable().optional(),
  length_mm: z.coerce.number().nullable().optional(),
  width_mm: z.coerce.number().nullable().optional(),
  height_mm: z.coerce.number().nullable().optional(),
  fragile: z.boolean().optional(),
  hazardous: z.boolean().optional(),
  active: z.boolean().optional(),
})
type FormData = z.infer<typeof schema>

export default function Items() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<null | 'create'>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['items', page, search],
    queryFn: () => itemsApi.list({ page, search, page_size: PAGE_SIZE }),
  })

  const createMutation = useMutation({
    mutationFn: (d: Partial<Item>) => itemsApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); setModal(null) },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  function openCreate() {
    reset({ sku: '', name: '', description: '', active: true, length_mm: undefined, width_mm: undefined, height_mm: undefined })
    setModal('create')
  }

  function openDetail(item: Item) {
    navigate(`/inventory/items/${item.id}`)
  }

  function onSubmit(d: FormData) {
    createMutation.mutate(d)
  }

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Items</h1>
          <p className="mt-1 text-sm text-slate-500">{data?.count ?? 0} SKUs in catalogue</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> New Item
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Items</CardTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search SKU or name…"
              className="h-9 w-64 rounded-lg border border-slate-200 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            onRowClick={openDetail}
            data={data?.results ?? []}
            columns={[
              { key: 'sku', header: 'SKU', render: (r) => <span className="font-mono font-medium">{r.sku}</span> },
              { key: 'name', header: 'Name' },
              { key: 'weight_grams', header: 'Weight (g)', render: (r) => r.weight_grams ?? '—' },
              {
                key: 'flags', header: 'Flags',
                render: (r) => (
                  <div className="flex gap-1 flex-wrap">
                    {r.fragile && <Badge label="Fragile" className="bg-orange-100 text-orange-700" />}
                    {r.hazardous && <Badge label="Hazardous" className="bg-red-100 text-red-700" />}
                    {r.requires_refrigeration && <Badge label="Cold" className="bg-sky-100 text-sky-700" />}
                  </div>
                ),
              },
              {
                key: 'active', header: 'Status',
                render: (r) => <Badge label={r.active ? 'Active' : 'Inactive'} className={r.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'} />,
              },
            ]}
          />
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </CardContent>
      </Card>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title="New Item"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="SKU" id="sku" error={errors.sku?.message} {...register('sku')} />
            <Input label="Name" id="name" error={errors.name?.message} {...register('name')} />
          </div>
          <Input label="Description" id="description" {...register('description')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Weight (g)" id="weight_grams" type="number" {...register('weight_grams')} />
            <Input label="Length (mm)" id="length_mm" type="number" {...register('length_mm')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Width (mm)" id="width_mm" type="number" {...register('width_mm')} />
            <Input label="Height (mm)" id="height_mm" type="number" {...register('height_mm')} />
          </div>
          <div className="flex gap-6">
            {(['fragile', 'hazardous', 'active'] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm capitalize">
                <input type="checkbox" {...register(f)} className="rounded" />
                {f}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
