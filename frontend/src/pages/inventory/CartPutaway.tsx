import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, CheckCircle2, Trash2, ShoppingCart, Route, AlertTriangle } from 'lucide-react'
import { quantsApi, binsApi, itemsApi, companiesApi, stockCategoriesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { Bin, Item, Quant } from '@/types'

type PutawayMode = 'manual' | 'consolidate' | 'empty' | 'fits'

const MODES: { value: PutawayMode; label: string; desc: string }[] = [
  { value: 'manual',      label: 'Manual',      desc: 'No auto-assign' },
  { value: 'consolidate', label: 'Consolidate', desc: 'Bins with this item' },
  { value: 'empty',       label: 'Empty',       desc: 'Bins with no stock' },
  { value: 'fits',        label: 'Fits',        desc: 'Volume fits qty' },
]

interface CartLine {
  id: string
  sku: string
  item: Item
  qty: number
  lot_code: string
  stock_category: string
  owner_id: number
  suggestedBin: Bin | null
  status: 'pending' | 'done' | 'error'
  errorMsg?: string
}

const addSchema = z.object({
  sku: z.string().min(1, 'SKU required'),
  qty: z.coerce.number().min(1, 'Qty ≥ 1'),
  lot_code: z.string().optional(),
  stock_category: z.string().min(1),
  owner_id: z.coerce.number().min(1, 'Select owner'),
})
type AddForm = z.infer<typeof addSchema>

export default function CartPutaway() {
  const qc = useQueryClient()
  const [phase, setPhase] = useState<'cart' | 'route'>('cart')
  const [mode, setMode] = useState<PutawayMode>(
    () => (localStorage.getItem('putaway-mode') as PutawayMode | null) ?? 'manual'
  )
  const [cartLines, setCartLines]     = useState<CartLine[]>([])
  const [assignedBinIds, setAssignedBinIds] = useState<Set<number>>(new Set())
  const [provisionalVolume, setProvisionalVolume] = useState<Map<number, number>>(new Map())
  const [isPuttingAway, setIsPuttingAway] = useState(false)
  const [addError, setAddError]       = useState<string | null>(null)
  const [isAdding, setIsAdding]       = useState(false)

  const { data: bins }      = useQuery({ queryKey: ['bins-all'],   queryFn: () => binsApi.list({ page_size: 1000 }) })
  const { data: items }     = useQuery({ queryKey: ['items-all'],  queryFn: () => itemsApi.list({ page_size: 1000 }) })
  const { data: companies } = useQuery({ queryKey: ['companies'],  queryFn: () => companiesApi.list() })
  const { data: cats }      = useQuery({ queryKey: ['stock-cats'], queryFn: () => stockCategoriesApi.list() })

  const activeBins = bins?.results.filter((b: Bin) => b.active) ?? []

  const { register, handleSubmit, reset, setFocus, formState: { errors } } = useForm<AddForm>({
    resolver: zodResolver(addSchema),
    defaultValues: { stock_category: 'UNRESTRICTED', qty: 1 },
  })

  function handleModeChange(newMode: PutawayMode) {
    setMode(newMode)
    localStorage.setItem('putaway-mode', newMode)
    setAssignedBinIds(new Set())
    setProvisionalVolume(new Map())
    setCartLines(prev => prev.map(l => ({ ...l, suggestedBin: null })))
  }

  async function computeSuggestedBin(item: Item, qty: number): Promise<Bin | null> {
    if (mode === 'consolidate') {
      const quants = await qc.fetchQuery({
        queryKey: ['quants-for-item', item.id],
        queryFn: () => quantsApi.list({ item: item.id, page_size: 1000 }),
        staleTime: 30_000,
      }) as { results: Quant[] }
      const binQtyMap = new Map<number, number>()
      for (const q of quants.results) {
        binQtyMap.set(q.bin, (binQtyMap.get(q.bin) ?? 0) + q.qty_available)
      }
      const bestEntry = [...binQtyMap.entries()].sort((a, b) => b[1] - a[1])[0]
      if (!bestEntry) return null
      return activeBins.find((b: Bin) => b.id === bestEntry[0]) ?? null
    }

    const unassigned = activeBins.filter((b: Bin) => !assignedBinIds.has(b.id))

    if (mode === 'empty') {
      return unassigned.find((b: Bin) => b.quants_count === 0) ?? null
    }

    if (mode === 'fits') {
      const itemVol = (item.length_mm ?? 0) * (item.width_mm ?? 0) * (item.height_mm ?? 0)
      if (itemVol === 0) return null
      const needed = itemVol * qty
      return unassigned
        .filter((b: Bin) => {
          const rem = provisionalVolume.get(b.id) ?? b.remaining_volume_mm3
          return b.bin_volume_mm3 > 0 && rem >= needed
        })
        .sort((a, b) => {
          const ra = provisionalVolume.get(a.id) ?? a.remaining_volume_mm3
          const rb = provisionalVolume.get(b.id) ?? b.remaining_volume_mm3
          return ra - rb
        })[0] ?? null
    }

    return null // manual
  }

  async function onAddLine(data: AddForm) {
    setAddError(null)
    setIsAdding(true)
    try {
      const item = items?.results.find((i: Item) => i.sku === data.sku)
      if (!item) { setAddError(`Item "${data.sku}" not found`); return }

      const suggestedBin = await computeSuggestedBin(item, data.qty)

      setCartLines(prev => [...prev, {
        id: crypto.randomUUID(),
        sku: data.sku,
        item,
        qty: data.qty,
        lot_code: data.lot_code ?? '',
        stock_category: data.stock_category,
        owner_id: data.owner_id,
        suggestedBin,
        status: 'pending',
      }])

      // Lock in bin for empty/fits modes
      if (suggestedBin && (mode === 'empty' || mode === 'fits')) {
        setAssignedBinIds(prev => new Set([...prev, suggestedBin.id]))
        if (mode === 'fits') {
          const itemVol = (item.length_mm ?? 0) * (item.width_mm ?? 0) * (item.height_mm ?? 0)
          const needed = itemVol * data.qty
          setProvisionalVolume(prev => {
            const next = new Map(prev)
            const cur = next.get(suggestedBin.id) ?? suggestedBin.remaining_volume_mm3
            next.set(suggestedBin.id, cur - needed)
            return next
          })
        }
      }

      reset({ stock_category: data.stock_category, owner_id: data.owner_id, qty: 1 })
      setTimeout(() => setFocus('sku'), 50)
    } catch {
      setAddError('Failed to compute bin suggestion')
    } finally {
      setIsAdding(false)
    }
  }

  function removeLine(id: string) {
    const line = cartLines.find(l => l.id === id)
    if (line?.suggestedBin && (mode === 'empty' || mode === 'fits')) {
      setAssignedBinIds(prev => { const n = new Set(prev); n.delete(line.suggestedBin!.id); return n })
      if (mode === 'fits') {
        const vol = (line.item.length_mm ?? 0) * (line.item.width_mm ?? 0) * (line.item.height_mm ?? 0) * line.qty
        setProvisionalVolume(prev => {
          const n = new Map(prev)
          n.set(line.suggestedBin!.id, (n.get(line.suggestedBin!.id) ?? 0) + vol)
          return n
        })
      }
    }
    setCartLines(prev => prev.filter(l => l.id !== id))
  }

  function startOver() {
    setCartLines([])
    setAssignedBinIds(new Set())
    setProvisionalVolume(new Map())
    setPhase('cart')
  }

  // Route: sort by bin location code ascending (numeric-aware); no-bin items at end
  const routeLines = [...cartLines].sort((a, b) => {
    const la = a.suggestedBin?.location_code ?? '\uFFFF'
    const lb = b.suggestedBin?.location_code ?? '\uFFFF'
    return la.localeCompare(lb, undefined, { numeric: true, sensitivity: 'base' })
  })

  async function putAwayLine(line: CartLine) {
    if (!line.suggestedBin) return
    try {
      await quantsApi.receiveGoods({
        bin_id: line.suggestedBin.id,
        item_sku: line.sku,
        qty: line.qty,
        lot_code: line.lot_code || undefined,
        stock_category: line.stock_category,
        owner_id: line.owner_id,
      })
      setCartLines(prev => prev.map(l => l.id === line.id ? { ...l, status: 'done' } : l))
    } catch {
      setCartLines(prev => prev.map(l => l.id === line.id ? { ...l, status: 'error', errorMsg: 'Failed' } : l))
    }
  }

  async function putAwayAll() {
    setIsPuttingAway(true)
    for (const line of routeLines) {
      if (line.status === 'pending' && line.suggestedBin) await putAwayLine(line)
    }
    setIsPuttingAway(false)
    qc.invalidateQueries({ queryKey: ['quants'] })
    qc.invalidateQueries({ queryKey: ['bins-all'] })
  }

  const pendingCount = cartLines.filter(l => l.status === 'pending').length
  const doneCount    = cartLines.filter(l => l.status === 'done').length
  const totalCount   = cartLines.length
  const noBinCount   = cartLines.filter(l => l.status === 'pending' && !l.suggestedBin).length
  const allDone      = totalCount > 0 && doneCount === totalCount

  // Group route lines by bin for display
  const routeGroups: { bin: Bin | null; lines: CartLine[] }[] = []
  for (const line of routeLines) {
    const last = routeGroups[routeGroups.length - 1]
    if (last && last.bin?.id === line.suggestedBin?.id) {
      last.lines.push(line)
    } else {
      routeGroups.push({ bin: line.suggestedBin, lines: [line] })
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cart Putaway</h1>
          <p className="mt-1 text-sm text-slate-500">
            Scan items onto a cart, then follow the sorted bin route to put them away
          </p>
        </div>
        <div className="flex gap-2">
          {phase === 'cart' && cartLines.length > 0 && (
            <Button onClick={() => setPhase('route')} disabled={pendingCount === 0}>
              <Route className="h-4 w-4" /> Generate Route ({pendingCount})
            </Button>
          )}
          {phase === 'route' && (
            <>
              <Button variant="secondary" onClick={() => setPhase('cart')}>← Back to Cart</Button>
              {allDone && <Button onClick={startOver}><Plus className="h-4 w-4" /> New Cart</Button>}
            </>
          )}
        </div>
      </div>

      {/* ── CART PHASE ─────────────────────────────────────────────────────── */}
      {phase === 'cart' && (
        <div className="space-y-5">
          {/* Mode selector */}
          <Card>
            <CardHeader><CardTitle>Putaway Mode</CardTitle></CardHeader>
            <CardContent>
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
                    {mode === m.value && <p className="mt-0.5 text-xs text-primary-500 font-medium">✓ default</p>}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Scan form */}
          <Card>
            <CardHeader><CardTitle>Scan Item onto Cart</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onAddLine)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Item SKU"
                    id="sku"
                    placeholder="Scan or type SKU…"
                    error={errors.sku?.message}
                    autoFocus
                    {...register('sku')}
                  />
                  <Input label="Quantity" id="qty" type="number" error={errors.qty?.message} {...register('qty')} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Input label="Lot Code (optional)" id="lot_code" {...register('lot_code')} />
                  <Select label="Stock Category" id="stock_category" error={errors.stock_category?.message} {...register('stock_category')}>
                    {cats?.results.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </Select>
                  <Select label="Owner" id="owner_id" error={errors.owner_id?.message} {...register('owner_id')}>
                    <option value="">Select…</option>
                    {companies?.results.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </div>
                {addError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{addError}</p>
                )}
                <div className="flex justify-end">
                  <Button type="submit" loading={isAdding}>
                    <Plus className="h-4 w-4" /> Add to Cart
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Cart list */}
          {cartLines.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-slate-500" />
                  <CardTitle>Cart — {cartLines.length} line{cartLines.length !== 1 ? 's' : ''}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">SKU</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Item</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Qty</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Target Bin</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Warehouse</th>
                      <th className="px-4 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cartLines.map(line => (
                      <tr key={line.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono font-medium text-slate-900">{line.sku}</td>
                        <td className="px-4 py-2 text-slate-600 truncate max-w-[180px]">{line.item.name}</td>
                        <td className="px-4 py-2 text-right font-semibold">{line.qty}</td>
                        <td className="px-4 py-2">
                          {line.suggestedBin
                            ? <span className="font-mono font-medium text-primary-700">{line.suggestedBin.location_code}</span>
                            : <span className="text-xs text-amber-500 italic">
                                {mode === 'manual' ? '—' : 'No bin available'}
                              </span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400">{line.suggestedBin?.warehouse_code ?? '—'}</td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => removeLine(line.id)}
                            className="rounded p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-slate-100 px-4 py-3 flex items-center justify-between">
                  {noBinCount > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {noBinCount} item{noBinCount !== 1 ? 's have' : ' has'} no assigned bin
                    </span>
                  )}
                  <Button className="ml-auto" onClick={() => setPhase('route')} disabled={pendingCount === 0}>
                    <Route className="h-4 w-4" /> Generate Route
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── ROUTE PHASE ────────────────────────────────────────────────────── */}
      {phase === 'route' && (
        <div className="space-y-4">
          {/* Header stats + actions */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-500">
              {doneCount} / {totalCount} lines put away
            </div>
            <div className="flex gap-2">
              {!allDone && (
                <Button loading={isPuttingAway} onClick={putAwayAll}>
                  Put Away All
                </Button>
              )}
              {allDone && (
                <div className="flex items-center gap-2 text-green-600 font-semibold text-sm">
                  <CheckCircle2 className="h-5 w-5" /> All done!
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300"
              style={{ width: totalCount > 0 ? `${(doneCount / totalCount) * 100}%` : '0%' }}
            />
          </div>

          {/* Route groups — one section per bin */}
          <div className="space-y-3">
            {routeGroups.map((group, gi) => (
              <Card key={gi} className={cn(
                group.lines.every(l => l.status === 'done') && 'opacity-50'
              )}>
                <div className={cn(
                  'flex items-center justify-between px-4 py-2 border-b rounded-t-lg',
                  group.bin
                    ? 'bg-primary-50 border-primary-100'
                    : 'bg-amber-50 border-amber-100'
                )}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-400 w-5 text-right">{gi + 1}</span>
                    {group.bin ? (
                      <>
                        <span className="font-mono font-bold text-primary-800 text-base">
                          {group.bin.location_code}
                        </span>
                        {group.bin.warehouse_code && (
                          <span className="text-xs text-primary-500">({group.bin.warehouse_code})</span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-600 font-medium text-sm flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" /> No bin assigned
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400">{group.lines.length} item{group.lines.length !== 1 ? 's' : ''}</span>
                </div>

                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-50">
                    {group.lines.map(line => (
                      <tr
                        key={line.id}
                        className={cn(
                          'transition-colors',
                          line.status === 'done'  && 'bg-green-50',
                          line.status === 'error' && 'bg-red-50',
                        )}
                      >
                        <td className="px-4 py-2.5 font-mono font-medium text-slate-900 w-32">{line.sku}</td>
                        <td className="px-4 py-2.5 text-slate-600">{line.item.name}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-lg text-slate-800 w-16">{line.qty}</td>
                        <td className="px-4 py-2.5 text-right w-28">
                          {line.status === 'done' && (
                            <span className="flex items-center justify-end gap-1 text-green-600 text-xs font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Done
                            </span>
                          )}
                          {line.status === 'error' && (
                            <span className="text-red-600 text-xs">{line.errorMsg}</span>
                          )}
                          {line.status === 'pending' && line.suggestedBin && (
                            <button
                              onClick={() => putAwayLine(line)}
                              className="rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors"
                            >
                              ✓ Done
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
