import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { quantsApi, binsApi, itemsApi, companiesApi, stockCategoriesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { Bin, Quant } from '@/types'

const schema = z.object({
  bin_id: z.coerce.number().min(1, 'Select a bin'),
  item_sku: z.string().min(1, 'SKU required'),
  qty: z.coerce.number().min(1, 'Qty must be ≥ 1'),
  lot_code: z.string().optional(),
  stock_category: z.string().min(1, 'Select a stock category'),
  owner_id: z.coerce.number().min(1, 'Select an owner'),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

type PutawayMode = 'manual' | 'consolidate' | 'empty' | 'fits'

const MODES: { value: PutawayMode; label: string; desc: string }[] = [
  { value: 'manual',      label: 'Manual',      desc: 'All active bins' },
  { value: 'consolidate', label: 'Consolidate', desc: 'Bins with this item' },
  { value: 'empty',       label: 'Empty',       desc: 'Bins with no stock' },
  { value: 'fits',        label: 'Fits',        desc: 'Volume fits qty' },
]

export default function ReceiveGoods() {
  const [success, setSuccess] = useState(false)
  const [mode, setMode] = useState<PutawayMode>('manual')

  const { data: bins }      = useQuery({ queryKey: ['bins-all'],   queryFn: () => binsApi.list({ page_size: 500 }) })
  const { data: items }     = useQuery({ queryKey: ['items-all'],  queryFn: () => itemsApi.list({ page_size: 500 }) })
  const { data: companies } = useQuery({ queryKey: ['companies'],  queryFn: () => companiesApi.list() })
  const { data: cats }      = useQuery({ queryKey: ['stock-cats'], queryFn: () => stockCategoriesApi.list() })

  const { register, handleSubmit, reset, control, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { stock_category: 'UNRESTRICTED', qty: 1 },
  })

  const selectedSku  = useWatch({ control, name: 'item_sku' })
  const selectedQty  = useWatch({ control, name: 'qty' })
  const selectedItem = items?.results.find((i) => i.sku === selectedSku)
  const itemVolume   = selectedItem
    ? (selectedItem.length_mm ?? 0) * (selectedItem.width_mm ?? 0) * (selectedItem.height_mm ?? 0)
    : 0

  const { data: itemQuants } = useQuery({
    queryKey: ['quants-for-item', selectedItem?.id],
    queryFn:  () => quantsApi.list({ item: selectedItem!.id, page_size: 1000 }),
    enabled:  mode === 'consolidate' && !!selectedItem?.id,
  })

  // Build filtered bin list based on putaway mode
  const activeBins = bins?.results.filter((b: Bin) => b.active) ?? []
  const filteredBins = (() => {
    if (mode === 'empty') return activeBins.filter((b: Bin) => b.quants_count === 0)
    if (mode === 'consolidate') {
      if (!selectedItem) return []
      const binIds = new Set(itemQuants?.results.map((q: Quant) => q.bin) ?? [])
      return activeBins.filter((b: Bin) => binIds.has(b.id))
    }
    if (mode === 'fits') {
      if (!selectedItem || itemVolume === 0) return []
      const needed = itemVolume * (Number(selectedQty) || 0)
      return activeBins.filter((b: Bin) => b.bin_volume_mm3 > 0 && b.remaining_volume_mm3 >= needed)
    }
    return activeBins
  })()

  // bin id → total available qty for this item (consolidate mode label)
  const binQtyMap = new Map<number, number>()
  if (mode === 'consolidate') {
    for (const q of itemQuants?.results ?? []) {
      binQtyMap.set(q.bin, (binQtyMap.get(q.bin) ?? 0) + q.qty_available)
    }
  }

  const handleModeChange = (newMode: PutawayMode) => {
    setMode(newMode)
    setValue('bin_id', 0 as unknown as number)
  }

  const mutation = useMutation({
    mutationFn: quantsApi.receiveGoods,
    onSuccess: () => { setSuccess(true); reset() },
  })

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Receive Goods</h1>
        <p className="mt-1 text-sm text-slate-500">Add stock to a bin location</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Receive into stock</CardTitle></CardHeader>
        <CardContent>
          {success && (
            <div className="mb-6 flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-green-700">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <p className="text-sm font-medium">Goods received successfully!</p>
              <button onClick={() => setSuccess(false)} className="ml-auto text-xs underline">Receive more</button>
            </div>
          )}

          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-5">

            {/* Item — must be selected before mode matters */}
            <Select label="Item SKU" id="item_sku" error={errors.item_sku?.message} {...register('item_sku')}>
              <option value="">Select item…</option>
              {items?.results.map((i) => (
                <option key={i.sku} value={i.sku}>{i.sku} — {i.name}</option>
              ))}
            </Select>

            {/* Putaway mode selector */}
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Putaway Mode</p>
              <div className="flex gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => handleModeChange(m.value)}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      mode === m.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <p className="font-medium">{m.label}</p>
                    <p className="text-xs opacity-70">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Bin — filtered per mode */}
            <Select label="Bin" id="bin_id" error={errors.bin_id?.message} {...register('bin_id')}>
              <option value="">
                {(mode === 'consolidate' || mode === 'fits') && !selectedItem
                  ? 'Select an item first…'
                  : 'Select bin…'}
              </option>
              {filteredBins.map((b: Bin) => (
                <option key={b.id} value={b.id}>
                  {b.location_code}
                  {b.warehouse_code ? ` (${b.warehouse_code})` : ''}
                  {mode === 'consolidate' && binQtyMap.has(b.id) ? ` · ${binQtyMap.get(b.id)} in stock` : ''}
                  {mode === 'fits' && b.bin_volume_mm3 > 0 ? ` · ${b.remaining_volume_mm3.toLocaleString()} mm³ free` : ''}
                </option>
              ))}
            </Select>

            {/* Helper hints */}
            {mode === 'consolidate' && selectedItem && filteredBins.length === 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                No bins currently hold this item. Switch to <strong>Manual</strong> to choose any bin.
              </p>
            )}
            {mode === 'empty' && filteredBins.length === 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                No empty bins available.
              </p>
            )}
            {mode === 'fits' && selectedItem && itemVolume === 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                This item has no dimensions set. Add length × width × height on the item to use this mode.
              </p>
            )}
            {mode === 'fits' && selectedItem && itemVolume > 0 && filteredBins.length === 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                No bins can fit {Number(selectedQty) || 0} × this item ({itemVolume.toLocaleString()} mm³ each). Try <strong>Manual</strong>.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Input label="Quantity" id="qty" type="number" error={errors.qty?.message} {...register('qty')} />
              <Input label="Lot Code (optional)" id="lot_code" {...register('lot_code')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Select label="Stock Category" id="stock_category" error={errors.stock_category?.message} {...register('stock_category')}>
                {cats?.results.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </Select>
              <Select label="Owner (Company)" id="owner_id" error={errors.owner_id?.message} {...register('owner_id')}>
                <option value="">Select owner…</option>
                {companies?.results.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>

            <Textarea label="Notes" id="notes" {...register('notes')} />

            {mutation.isError && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
                {(mutation.error as Error)?.message ?? 'Failed to receive goods'}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending}>Receive Goods</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
