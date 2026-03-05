import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit2, Package, Warehouse } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { itemsApi, quantsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table, Pagination } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import type { Item, Quant } from '@/types'

const PAGE_SIZE = 20

const schema = z.object({
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

interface WarehouseStock {
  warehouse_code: string
  qty: number
  qty_reserved: number
  qty_available: number
}

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const itemId = Number(id)
  const [editOpen, setEditOpen] = useState(false)
  const [quantPage, setQuantPage] = useState(1)

  const { data: item, isLoading: itemLoading } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => itemsApi.get(itemId),
  })

  const { data: quants, isLoading: quantsLoading } = useQuery({
    queryKey: ['quants', 'item', itemId, quantPage],
    queryFn: () => quantsApi.list({ item: itemId, page: quantPage, page_size: PAGE_SIZE }),
    enabled: !!item,
  })

  // Aggregate stock per warehouse from all quants (fetch without pagination for the summary)
  const { data: allQuants } = useQuery({
    queryKey: ['quants', 'item', itemId, 'all'],
    queryFn: () => quantsApi.list({ item: itemId, page_size: 1000 }),
    enabled: !!item,
  })

  const warehouseStock: WarehouseStock[] = Object.values(
    (allQuants?.results ?? []).reduce<Record<string, WarehouseStock>>((acc, q: Quant) => {
      const key = q.bin_warehouse_code ?? 'Unknown'
      if (!acc[key]) acc[key] = { warehouse_code: key, qty: 0, qty_reserved: 0, qty_available: 0 }
      acc[key].qty += q.qty
      acc[key].qty_reserved += q.qty_reserved
      acc[key].qty_available += q.qty_available
      return acc
    }, {})
  )

  const updateMutation = useMutation({
    mutationFn: (d: Partial<Item>) => itemsApi.update(itemId, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['item', itemId] }); setEditOpen(false) },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  function openEdit() {
    if (!item) return
    reset({ name: item.name, description: item.description, weight_grams: item.weight_grams, length_mm: item.length_mm, width_mm: item.width_mm, height_mm: item.height_mm, fragile: item.fragile, hazardous: item.hazardous, active: item.active })
    setEditOpen(true)
  }

  const totalQuantPages = Math.ceil((quants?.count ?? 0) / PAGE_SIZE)

  if (itemLoading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" /></div>
  if (!item) return <p className="p-8 text-slate-500">Item not found</p>

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => navigate('/inventory/items')} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 font-mono">{item.sku}</h1>
            <Badge
              label={item.active ? 'Active' : 'Inactive'}
              className={item.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}
            />
            {item.fragile && <Badge label="Fragile" className="bg-orange-100 text-orange-700" />}
            {item.hazardous && <Badge label="Hazardous" className="bg-red-100 text-red-700" />}
          </div>
          <p className="mt-1 text-slate-600">{item.name}</p>
        </div>
        <Button variant="secondary" onClick={openEdit}>
          <Edit2 className="h-4 w-4" /> Edit
        </Button>
      </div>

      {/* Item details */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mb-6">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Details</CardTitle><Package className="h-4 w-4 text-slate-400" /></CardHeader>
          <CardContent className="text-sm space-y-3 py-4">
            {[
              ['SKU', item.sku],
              ['Name', item.name],
              ['Description', item.description || '—'],
              ['Weight', item.weight_grams ? `${item.weight_grams} g` : '—'],
              ['Dimensions (L×W×H)', (item.length_mm || item.width_mm || item.height_mm) ? `${item.length_mm ?? 0} × ${item.width_mm ?? 0} × ${item.height_mm ?? 0} mm` : '—'],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-slate-900 mt-0.5">{val}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Stock per warehouse */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Stock by Warehouse</CardTitle><Warehouse className="h-4 w-4 text-slate-400" /></CardHeader>
          <CardContent className="p-0">
            {warehouseStock.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No stock for this item</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Warehouse', 'Total Qty', 'Reserved', 'Available'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {warehouseStock.map((ws) => (
                    <tr key={ws.warehouse_code} className="border-b border-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{ws.warehouse_code}</td>
                      <td className="px-4 py-3 text-slate-700">{ws.qty}</td>
                      <td className="px-4 py-3 text-amber-600">{ws.qty_reserved}</td>
                      <td className="px-4 py-3 font-semibold text-green-600">{ws.qty_available}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* All quants */}
      <Card>
        <CardHeader>
          <CardTitle>All Stock Records ({quants?.count ?? 0} quants)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table
            loading={quantsLoading}
            keyExtractor={(r: Quant) => r.id}
            data={quants?.results ?? []}
            columns={[
              { key: 'bin_location', header: 'Bin', render: (r: Quant) => <span className="font-mono">{r.bin_location}</span> },
              { key: 'bin_warehouse_code', header: 'Warehouse', render: (r: Quant) => r.bin_warehouse_code ?? '—' },
              { key: 'lot_code', header: 'Lot', render: (r: Quant) => r.lot_code ?? '—' },
              { key: 'stock_category', header: 'Category', render: (r: Quant) => <span className="font-mono text-xs">{r.stock_category}</span> },
              { key: 'qty', header: 'Qty', render: (r: Quant) => <span className="font-medium">{r.qty}</span> },
              { key: 'qty_reserved', header: 'Reserved', render: (r: Quant) => <span className="text-amber-600">{r.qty_reserved}</span> },
              { key: 'qty_available', header: 'Available', render: (r: Quant) => <span className="font-semibold text-green-600">{r.qty_available}</span> },
            ]}
          />
          <Pagination page={quantPage} totalPages={totalQuantPages} onPage={setQuantPage} />
        </CardContent>
      </Card>

      {/* Edit modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Item">
        <form onSubmit={handleSubmit((d) => updateMutation.mutate(d))} className="space-y-4">
          <Input label="Name" error={errors.name?.message} {...register('name')} />
          <Input label="Description" {...register('description')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Weight (g)" type="number" {...register('weight_grams')} />
            <Input label="Length (mm)" type="number" {...register('length_mm')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Width (mm)" type="number" {...register('width_mm')} />
            <Input label="Height (mm)" type="number" {...register('height_mm')} />
          </div>
          <div className="flex gap-6">
            {(['fragile', 'hazardous', 'active'] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm capitalize">
                <input type="checkbox" {...register(f)} className="rounded" /> {f}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" loading={updateMutation.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
