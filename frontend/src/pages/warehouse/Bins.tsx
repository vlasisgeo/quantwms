import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Grid3X3, Trash2, PowerOff } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { binsApi, warehousesApi, sectionsApi, binTypesApi } from '@/api'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Table, Pagination } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import type { Bin } from '@/types'

const PAGE_SIZE = 25

const singleSchema = z.object({
  warehouse: z.coerce.number().min(1),
  section: z.coerce.number().min(1),
  location_code: z.string().min(1),
  bin_type: z.coerce.number().optional(),
})
type SingleForm = z.infer<typeof singleSchema>

const massSchema = z.object({
  warehouse: z.coerce.number().min(1),
  section: z.coerce.number().min(1),
  format: z.string().min(1).default('{aisle}-{bay}-{level}'),
  aisle_from: z.coerce.number().min(1).default(1),
  aisle_to: z.coerce.number().min(1).default(3),
  bay_from: z.coerce.number().min(1).default(1),
  bay_to: z.coerce.number().min(1).default(10),
  level_from: z.coerce.number().min(1).default(1),
  level_to: z.coerce.number().min(1).default(4),
  pad_aisle: z.coerce.number().default(2),
  pad_bay: z.coerce.number().default(2),
  pad_level: z.coerce.number().default(1),
})
type MassForm = z.infer<typeof massSchema>

export default function Bins() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [modalType, setModalType] = useState<null | 'single' | 'mass' | 'confirmDelete'>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['bins', page, search],
    queryFn: () => binsApi.list({ page, search, page_size: PAGE_SIZE }),
  })
  const { data: warehouses } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() })
  const { data: sections }   = useQuery({ queryKey: ['sections'],   queryFn: () => sectionsApi.list() })
  const { data: binTypes }   = useQuery({ queryKey: ['bin-types'],  queryFn: () => binTypesApi.list() })

  const singleMutation = useMutation({
    mutationFn: binsApi.createLocation,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bins'] }); setModalType(null) },
  })
  const massMutation = useMutation({
    mutationFn: binsApi.massCreate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bins'] }); setModalType(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => api.delete(`/bins/${id}/`))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bins'] })
      setSelected(new Set())
      setModalType(null)
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => binsApi.patch(id, { active: false }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bins'] })
      setSelected(new Set())
    },
  })

  const singleForm = useForm<SingleForm>({ resolver: zodResolver(singleSchema) })
  const massForm = useForm<MassForm>({ resolver: zodResolver(massSchema), defaultValues: { format: '{aisle}-{bay}-{level}', pad_aisle: 2, pad_bay: 2, pad_level: 1 } })

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)
  const pageResults: Bin[] = data?.results ?? []
  const pageIds = pageResults.map((b) => b.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  // Map id→bin for the current page to inspect quants_count
  const binById = Object.fromEntries(pageResults.map((b) => [b.id, b]))
  // True if any selected bin (visible on this page) has stock — delete is blocked
  const selectedWithStock = [...selected].filter((id) => (binById[id]?.quants_count ?? 0) > 0)
  const canDelete = selected.size > 0 && selectedWithStock.length === 0

  function toggleRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allPageSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        pageIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelected((prev) => new Set([...prev, ...pageIds]))
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bins</h1>
          <p className="mt-1 text-sm text-slate-500">{data?.count ?? 0} bin locations</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setModalType('mass')}>
            <Grid3X3 className="h-4 w-4" /> Mass Create (Dexion)
          </Button>
          <Button onClick={() => setModalType('single')}>
            <Plus className="h-4 w-4" /> New Bin
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>All Bins</CardTitle>
            {selected.size > 0 && (
              <>
                <Button
                  variant="secondary"
                  loading={deactivateMutation.isPending}
                  onClick={() => deactivateMutation.mutate([...selected])}
                >
                  <PowerOff className="h-4 w-4" /> Deactivate ({selected.size})
                </Button>
                <div className="relative group">
                  <Button
                    variant="danger"
                    onClick={() => canDelete && setModalType('confirmDelete')}
                    className={!canDelete ? 'opacity-40 cursor-not-allowed' : ''}
                  >
                    <Trash2 className="h-4 w-4" /> Delete ({selected.size})
                  </Button>
                  {!canDelete && selectedWithStock.length > 0 && (
                    <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-56 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-lg">
                      {selectedWithStock.length} selected bin{selectedWithStock.length !== 1 ? 's have' : ' has'} stock and cannot be deleted.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={toggleAll}
                className="rounded"
              />
              Select page
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search location code…"
                className="h-9 w-56 rounded-lg border border-slate-200 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r: Bin) => r.id}
            data={data?.results ?? []}
            columns={[
              {
                key: 'select',
                header: '',
                className: 'w-10',
                render: (r: Bin) => (
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleRow(r.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded"
                  />
                ),
              },
              { key: 'location_code', header: 'Location Code', render: (r: Bin) => <span className="font-mono font-medium">{r.location_code}</span> },
              { key: 'warehouse_code', header: 'Warehouse' },
              { key: 'section_code', header: 'Section', render: (r: Bin) => r.section_code ?? '—' },
              { key: 'bin_type_name', header: 'Bin Type', render: (r: Bin) => r.bin_type_name ? <span className="text-xs font-medium text-slate-600">{r.bin_type_name}</span> : <span className="text-slate-300">—</span> },
              { key: 'quants_count', header: 'Stock', render: (r: Bin) => r.quants_count > 0 ? <span className="font-medium text-amber-600">{r.quants_count}</span> : <span className="text-slate-400">0</span> },
              { key: 'active', header: 'Active', render: (r: Bin) => r.active ? '✅' : '—' },
            ]}
          />
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </CardContent>
      </Card>

      {/* Single create modal */}
      <Modal open={modalType === 'single'} onClose={() => setModalType(null)} title="New Bin Location">
        <form onSubmit={singleForm.handleSubmit((d) => singleMutation.mutate(d))} className="space-y-4">
          <Select label="Warehouse" {...singleForm.register('warehouse')}>
            <option value="">Select…</option>
            {warehouses?.results.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
          </Select>
          <Select label="Section" {...singleForm.register('section')}>
            <option value="">Select…</option>
            {sections?.results.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </Select>
          <Input label="Location Code" placeholder="A-01-01" {...singleForm.register('location_code')} />
          <Select label="Bin Type (optional)" {...singleForm.register('bin_type')}>
            <option value="">None</option>
            {binTypes?.results.map((bt) => <option key={bt.id} value={bt.id}>{bt.name}</option>)}
          </Select>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setModalType(null)}>Cancel</Button>
            <Button type="submit" loading={singleMutation.isPending}>Create</Button>
          </div>
        </form>
      </Modal>

      {/* Confirm delete modal */}
      <Modal open={modalType === 'confirmDelete'} onClose={() => setModalType(null)} title="Delete Bins">
        <p className="text-sm text-slate-600 mb-6">
          Are you sure you want to delete <span className="font-semibold">{selected.size}</span> bin{selected.size !== 1 ? 's' : ''}? This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setModalType(null)}>Cancel</Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate([...selected])}
          >
            Delete {selected.size} bin{selected.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </Modal>

      {/* Mass create modal */}
      <Modal open={modalType === 'mass'} onClose={() => setModalType(null)} title="Mass Create Dexion Bins" size="lg">
        <form onSubmit={massForm.handleSubmit((d) => massMutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="Warehouse" {...massForm.register('warehouse')}>
              <option value="">Select…</option>
              {warehouses?.results.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </Select>
            <Select label="Section" {...massForm.register('section')}>
              <option value="">Select…</option>
              {sections?.results.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
            </Select>
          </div>
          <Input label="Format" placeholder="{aisle}-{bay}-{level}" {...massForm.register('format')} />
          <div className="grid grid-cols-3 gap-4">
            <Input label="Aisle from" type="number" {...massForm.register('aisle_from')} />
            <Input label="Aisle to" type="number" {...massForm.register('aisle_to')} />
            <Input label="Pad aisle" type="number" {...massForm.register('pad_aisle')} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Bay from" type="number" {...massForm.register('bay_from')} />
            <Input label="Bay to" type="number" {...massForm.register('bay_to')} />
            <Input label="Pad bay" type="number" {...massForm.register('pad_bay')} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Level from" type="number" {...massForm.register('level_from')} />
            <Input label="Level to" type="number" {...massForm.register('level_to')} />
            <Input label="Pad level" type="number" {...massForm.register('pad_level')} />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setModalType(null)}>Cancel</Button>
            <Button type="submit" loading={massMutation.isPending}>Create Bins</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
