import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, CheckCircle2, Trash2, ShoppingCart,
  Route, AlertTriangle, ChevronRight, X,
} from 'lucide-react'
import { quantsApi, binsApi, itemsApi, companiesApi, stockCategoriesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { Bin, Item, Quant } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────

type PutawayMode = 'manual' | 'consolidate' | 'empty' | 'fits'

const MODES: { value: PutawayMode; label: string; desc: string }[] = [
  { value: 'manual',      label: 'Manual',      desc: 'No auto-assign' },
  { value: 'consolidate', label: 'Consolidate', desc: 'Bins with this item' },
  { value: 'empty',       label: 'Empty',       desc: 'Bins with no stock' },
  { value: 'fits',        label: 'Fits',        desc: 'Volume fits qty' },
]

interface SlimBin {
  id: number
  location_code: string
  warehouse_code?: string
  bin_volume_mm3: number
  remaining_volume_mm3: number
  quants_count: number
}

interface CartLine {
  id: string
  slot: string           // e.g. "A1", "A2"
  sku: string
  item: Item
  qty: number
  lot_code: string
  stock_category: string
  suggestedBin: SlimBin | null
  status: 'pending' | 'done' | 'error'
  errorMsg?: string
}

interface StoredCart {
  id: string
  label: string
  companyId: number
  companyName: string
  slotPrefix: string     // e.g. "A" → slots A1, A2, A3…
  slotCount: number      // max slots
  nextSlot: number       // counter for next slot number
  mode: PutawayMode
  lines: CartLine[]
  assignedBinIds: number[]
  provisionalVolume: [number, number][]
  status: 'active' | 'done'
  createdAt: string
}

// ── localStorage helpers ────────────────────────────────────────────────────

const CARTS_KEY      = 'putaway-carts'
const ACTIVE_CART_KEY = 'putaway-active-cart'

function loadCarts(): StoredCart[] {
  try { return JSON.parse(localStorage.getItem(CARTS_KEY) ?? '[]') } catch { return [] }
}
function saveCarts(carts: StoredCart[]) {
  localStorage.setItem(CARTS_KEY, JSON.stringify(carts))
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const createCartSchema = z.object({
  companyId: z.coerce.number().min(1, 'Select a company'),
  label:       z.string().min(1, 'Label required'),
  slotPrefix:  z.string().min(1).max(3).default('A'),
  slotCount:   z.coerce.number().min(1).max(200).default(40),
  mode:        z.enum(['manual', 'consolidate', 'empty', 'fits']).default('manual'),
})
type CreateCartForm = z.infer<typeof createCartSchema>

const addLineSchema = z.object({
  sku:            z.string().min(1, 'SKU required'),
  qty:            z.coerce.number().min(1, 'Qty ≥ 1'),
  lot_code:       z.string().optional(),
  stock_category: z.string().min(1),
})
type AddLineForm = z.infer<typeof addLineSchema>

// ── Component ───────────────────────────────────────────────────────────────

export default function CartPutaway() {
  const qc = useQueryClient()

  const [carts, setCarts]           = useState<StoredCart[]>(loadCarts)
  const [activeCartId, setActiveCartId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_CART_KEY)
  )
  const [phase, setPhase]           = useState<'cart' | 'route'>('cart')
  const [showCreate, setShowCreate] = useState(false)
  const [isPuttingAway, setIsPuttingAway] = useState(false)
  const [isAdding, setIsAdding]     = useState(false)
  const [addError, setAddError]     = useState<string | null>(null)

  const { data: bins }      = useQuery({ queryKey: ['bins-all'],   queryFn: () => binsApi.list({ page_size: 1000 }) })
  const { data: items }     = useQuery({ queryKey: ['items-all'],  queryFn: () => itemsApi.list({ page_size: 1000 }) })
  const { data: companies } = useQuery({ queryKey: ['companies'],  queryFn: () => companiesApi.list() })
  const { data: cats }      = useQuery({ queryKey: ['stock-cats'], queryFn: () => stockCategoriesApi.list() })

  const activeBins = bins?.results.filter((b: Bin) => b.active) ?? []
  const activeCart = carts.find(c => c.id === activeCartId) ?? null

  // ── Cart management ────────────────────────────────────────────────────

  function updateCart(id: string, updater: (c: StoredCart) => StoredCart) {
    setCarts(prev => {
      const next = prev.map(c => c.id === id ? updater(c) : c)
      saveCarts(next)
      return next
    })
  }

  function openCart(id: string) {
    setActiveCartId(id)
    localStorage.setItem(ACTIVE_CART_KEY, id)
    setPhase('cart')
    setAddError(null)
  }

  function closeCart() {
    setActiveCartId(null)
    localStorage.removeItem(ACTIVE_CART_KEY)
    setPhase('cart')
  }

  function deleteCart(id: string) {
    setCarts(prev => { const next = prev.filter(c => c.id !== id); saveCarts(next); return next })
    if (activeCartId === id) closeCart()
  }

  const createForm = useForm<CreateCartForm>({
    resolver: zodResolver(createCartSchema),
    defaultValues: {
      slotPrefix: 'A',
      slotCount: 40,
      mode: (localStorage.getItem('putaway-mode') as PutawayMode) ?? 'manual',
    },
  })

  function onCreateCart(data: CreateCartForm) {
    const company = companies?.results.find(c => c.id === data.companyId)
    const cart: StoredCart = {
      id: crypto.randomUUID(),
      label: data.label,
      companyId: data.companyId,
      companyName: company?.name ?? String(data.companyId),
      slotPrefix: data.slotPrefix.toUpperCase(),
      slotCount: data.slotCount,
      nextSlot: 1,
      mode: data.mode,
      lines: [],
      assignedBinIds: [],
      provisionalVolume: [],
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    setCarts(prev => { const next = [...prev, cart]; saveCarts(next); return next })
    setShowCreate(false)
    createForm.reset()
    openCart(cart.id)
  }

  // ── Bin suggestion ─────────────────────────────────────────────────────

  async function computeSuggestedBin(
    item: Item, qty: number, cart: StoredCart
  ): Promise<SlimBin | null> {
    const assignedSet = new Set(cart.assignedBinIds)
    const provMap     = new Map<number, number>(cart.provisionalVolume)

    if (cart.mode === 'consolidate') {
      const quants = await qc.fetchQuery({
        queryKey: ['quants-for-item', item.id],
        queryFn: () => quantsApi.list({ item: item.id, page_size: 1000 }),
        staleTime: 30_000,
      }) as { results: Quant[] }
      const binQtyMap = new Map<number, number>()
      for (const q of quants.results) {
        binQtyMap.set(q.bin, (binQtyMap.get(q.bin) ?? 0) + q.qty_available)
      }
      const best = [...binQtyMap.entries()].sort((a, b) => b[1] - a[1])[0]
      if (!best) return null
      return activeBins.find((b: Bin) => b.id === best[0]) ?? null
    }

    const unassigned = activeBins.filter((b: Bin) => !assignedSet.has(b.id))

    if (cart.mode === 'empty') {
      return unassigned.find((b: Bin) => b.quants_count === 0) ?? null
    }

    if (cart.mode === 'fits') {
      const vol = (item.length_mm ?? 0) * (item.width_mm ?? 0) * (item.height_mm ?? 0)
      if (vol === 0) return null
      const needed = vol * qty
      return unassigned
        .filter((b: Bin) => {
          const rem = provMap.get(b.id) ?? b.remaining_volume_mm3
          return b.bin_volume_mm3 > 0 && rem >= needed
        })
        .sort((a, b) => {
          const ra = provMap.get(a.id) ?? a.remaining_volume_mm3
          const rb = provMap.get(b.id) ?? b.remaining_volume_mm3
          return ra - rb
        })[0] ?? null
    }

    return null
  }

  // ── Add line ──────────────────────────────────────────────────────────

  const addForm = useForm<AddLineForm>({
    resolver: zodResolver(addLineSchema),
    defaultValues: { stock_category: 'UNRESTRICTED', qty: 1 },
  })

  async function onAddLine(data: AddLineForm) {
    if (!activeCart) return
    if (activeCart.nextSlot > activeCart.slotCount) {
      setAddError(`Cart is full (${activeCart.slotCount} slots)`)
      return
    }
    setAddError(null)
    setIsAdding(true)
    try {
      const item = items?.results.find((i: Item) => i.sku === data.sku)
      if (!item) { setAddError(`Item "${data.sku}" not found`); return }

      const suggestedBin = await computeSuggestedBin(item, data.qty, activeCart)
      const slot = `${activeCart.slotPrefix}${activeCart.nextSlot}`

      updateCart(activeCart.id, cart => {
        const newLine: CartLine = {
          id: crypto.randomUUID(),
          slot,
          sku: data.sku,
          item,
          qty: data.qty,
          lot_code: data.lot_code ?? '',
          stock_category: data.stock_category,
          suggestedBin: suggestedBin
            ? { id: suggestedBin.id, location_code: (suggestedBin as Bin).location_code,
                warehouse_code: (suggestedBin as Bin).warehouse_code,
                bin_volume_mm3: (suggestedBin as Bin).bin_volume_mm3,
                remaining_volume_mm3: (suggestedBin as Bin).remaining_volume_mm3,
                quants_count: (suggestedBin as Bin).quants_count }
            : null,
          status: 'pending',
        }
        const newAssigned = suggestedBin && (cart.mode === 'empty' || cart.mode === 'fits')
          ? [...cart.assignedBinIds, suggestedBin.id]
          : cart.assignedBinIds
        let newProv = cart.provisionalVolume
        if (suggestedBin && cart.mode === 'fits') {
          const itemVol = (item.length_mm ?? 0) * (item.width_mm ?? 0) * (item.height_mm ?? 0) * data.qty
          const provMap = new Map<number, number>(cart.provisionalVolume)
          const cur = provMap.get(suggestedBin.id) ?? (suggestedBin as Bin).remaining_volume_mm3
          provMap.set(suggestedBin.id, cur - itemVol)
          newProv = [...provMap.entries()]
        }
        return { ...cart, lines: [...cart.lines, newLine], nextSlot: cart.nextSlot + 1, assignedBinIds: newAssigned, provisionalVolume: newProv }
      })

      addForm.reset({ stock_category: data.stock_category, qty: 1 })
      setTimeout(() => addForm.setFocus('sku'), 50)
    } catch {
      setAddError('Failed to compute bin suggestion')
    } finally {
      setIsAdding(false)
    }
  }

  function removeLine(lineId: string) {
    if (!activeCart) return
    const line = activeCart.lines.find(l => l.id === lineId)
    updateCart(activeCart.id, cart => {
      let newAssigned = cart.assignedBinIds
      let newProv     = cart.provisionalVolume
      if (line?.suggestedBin && (cart.mode === 'empty' || cart.mode === 'fits')) {
        newAssigned = cart.assignedBinIds.filter(id => id !== line.suggestedBin!.id)
        if (cart.mode === 'fits' && line.suggestedBin) {
          const vol = (line.item.length_mm ?? 0) * (line.item.width_mm ?? 0) * (line.item.height_mm ?? 0) * line.qty
          const m = new Map<number, number>(cart.provisionalVolume)
          m.set(line.suggestedBin.id, (m.get(line.suggestedBin.id) ?? 0) + vol)
          newProv = [...m.entries()]
        }
      }
      return { ...cart, lines: cart.lines.filter(l => l.id !== lineId), assignedBinIds: newAssigned, provisionalVolume: newProv }
    })
  }

  // ── Putaway ────────────────────────────────────────────────────────────

  async function putAwayLine(line: CartLine) {
    if (!activeCart || !line.suggestedBin) return
    try {
      await quantsApi.receiveGoods({
        bin_id: line.suggestedBin.id,
        item_sku: line.sku,
        qty: line.qty,
        lot_code: line.lot_code || undefined,
        stock_category: line.stock_category,
        owner_id: activeCart.companyId,
      })
      updateCart(activeCart.id, cart => ({
        ...cart,
        lines: cart.lines.map(l => l.id === line.id ? { ...l, status: 'done' } : l),
      }))
    } catch {
      updateCart(activeCart.id, cart => ({
        ...cart,
        lines: cart.lines.map(l => l.id === line.id ? { ...l, status: 'error', errorMsg: 'Failed' } : l),
      }))
    }
  }

  async function putAwayAll() {
    if (!activeCart) return
    setIsPuttingAway(true)
    for (const line of routeLines) {
      if (line.status === 'pending' && line.suggestedBin) await putAwayLine(line)
    }
    setIsPuttingAway(false)
    qc.invalidateQueries({ queryKey: ['quants'] })
    qc.invalidateQueries({ queryKey: ['bins-all'] })
    updateCart(activeCart.id, cart => ({
      ...cart,
      status: cart.lines.every(l => l.status === 'done') ? 'done' : 'active',
    }))
  }

  // ── Route computation ──────────────────────────────────────────────────

  const routeLines = activeCart
    ? [...activeCart.lines].sort((a, b) => {
        const la = a.suggestedBin?.location_code ?? '\uFFFF'
        const lb = b.suggestedBin?.location_code ?? '\uFFFF'
        return la.localeCompare(lb, undefined, { numeric: true, sensitivity: 'base' })
      })
    : []

  const routeGroups: { bin: SlimBin | null; lines: CartLine[] }[] = []
  for (const line of routeLines) {
    const last = routeGroups[routeGroups.length - 1]
    if (last && last.bin?.id === line.suggestedBin?.id) last.lines.push(line)
    else routeGroups.push({ bin: line.suggestedBin, lines: [line] })
  }

  // ── Derived counts ─────────────────────────────────────────────────────

  const totalLines   = activeCart?.lines.length ?? 0
  const doneLines    = activeCart?.lines.filter(l => l.status === 'done').length ?? 0
  const pendingLines = activeCart?.lines.filter(l => l.status === 'pending').length ?? 0
  const noBinLines   = activeCart?.lines.filter(l => l.status === 'pending' && !l.suggestedBin).length ?? 0
  const allDone      = totalLines > 0 && doneLines === totalLines

  // Group carts by company for the selector
  const cartsByCompany = carts.reduce<Record<string, StoredCart[]>>((acc, c) => {
    ;(acc[c.companyName] ??= []).push(c)
    return acc
  }, {})

  // ── Render: Cart Selector ──────────────────────────────────────────────

  if (!activeCart) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Cart Putaway</h1>
            <p className="mt-1 text-sm text-slate-500">Select an active cart or create a new one</p>
          </div>
          <Button onClick={() => setShowCreate(v => !v)}>
            <Plus className="h-4 w-4" /> New Cart
          </Button>
        </div>

        {/* Create cart form */}
        {showCreate && (
          <Card className="mb-6 border-primary-200 bg-primary-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>New Cart</CardTitle>
                <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={createForm.handleSubmit(onCreateCart)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Select
                    label="Company"
                    id="companyId"
                    error={createForm.formState.errors.companyId?.message}
                    {...createForm.register('companyId')}
                  >
                    <option value="">Select company…</option>
                    {companies?.results.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                  <Input
                    label="Cart Label"
                    id="label"
                    placeholder="e.g. Cart A"
                    error={createForm.formState.errors.label?.message}
                    {...createForm.register('label')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Slot Prefix (A → A1, A2…)"
                    id="slotPrefix"
                    placeholder="A"
                    error={createForm.formState.errors.slotPrefix?.message}
                    {...createForm.register('slotPrefix')}
                  />
                  <Input
                    label="Number of Slots"
                    id="slotCount"
                    type="number"
                    error={createForm.formState.errors.slotCount?.message}
                    {...createForm.register('slotCount')}
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-700">Putaway Mode</p>
                  <div className="flex gap-2">
                    {MODES.map(m => (
                      <label
                        key={m.value}
                        className={cn(
                          'flex-1 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors',
                          createForm.watch('mode') === m.value
                            ? 'border-primary-500 bg-white text-primary-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        )}
                      >
                        <input type="radio" value={m.value} className="sr-only" {...createForm.register('mode')} />
                        <p className="font-medium">{m.label}</p>
                        <p className="text-xs opacity-70">{m.desc}</p>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button type="submit">Create & Open</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Cart list */}
        {carts.length === 0 && !showCreate && (
          <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
            <ShoppingCart className="mx-auto h-10 w-10 text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">No carts yet</p>
            <p className="text-sm text-slate-400 mt-1">Create a cart to start receiving</p>
          </div>
        )}

        {Object.entries(cartsByCompany).map(([companyName, companyCarts]) => (
          <div key={companyName} className="mb-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{companyName}</p>
            <div className="space-y-2">
              {companyCarts.map(cart => (
                <div
                  key={cart.id}
                  className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-primary-300 hover:bg-primary-50 transition-colors cursor-pointer"
                  onClick={() => openCart(cart.id)}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 font-bold text-sm shrink-0">
                    {cart.slotPrefix}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{cart.label}</p>
                    <p className="text-xs text-slate-400">
                      {cart.slotPrefix}1 – {cart.slotPrefix}{cart.slotCount} · {cart.lines.length} item{cart.lines.length !== 1 ? 's' : ''} · {cart.mode}
                    </p>
                  </div>
                  {cart.status === 'done' && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Done</span>
                  )}
                  {cart.status === 'active' && cart.lines.some(l => l.status === 'done') && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {cart.lines.filter(l => l.status === 'done').length}/{cart.lines.length}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                  <button
                    onClick={e => { e.stopPropagation(); deleteCart(cart.id) }}
                    className="rounded p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Render: Active Cart ────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <button onClick={closeCart} className="text-slate-400 hover:text-slate-700 text-sm">← All Carts</button>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 font-bold shrink-0">
          {activeCart.slotPrefix}
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900">{activeCart.label}</h1>
          <p className="text-xs text-slate-400">
            {activeCart.companyName} · Slots {activeCart.slotPrefix}1–{activeCart.slotPrefix}{activeCart.slotCount} · {activeCart.mode} mode
          </p>
        </div>
        <div className="flex gap-2">
          {phase === 'cart' && pendingLines > 0 && (
            <Button onClick={() => setPhase('route')}>
              <Route className="h-4 w-4" /> Generate Route ({pendingLines})
            </Button>
          )}
          {phase === 'route' && (
            <Button variant="secondary" onClick={() => setPhase('cart')}>← Back to Cart</Button>
          )}
          {allDone && (
            <Button onClick={() => deleteCart(activeCart.id)}>
              <CheckCircle2 className="h-4 w-4" /> Close Cart
            </Button>
          )}
        </div>
      </div>

      {/* ── CART PHASE ─────────────────────────────────────────────────── */}
      {phase === 'cart' && (
        <div className="space-y-5">
          {/* Scan form */}
          <Card>
            <CardHeader>
              <CardTitle>
                Scan Item
                {activeCart.nextSlot <= activeCart.slotCount && (
                  <span className="ml-2 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-semibold text-primary-700">
                    Next slot: {activeCart.slotPrefix}{activeCart.nextSlot}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeCart.nextSlot > activeCart.slotCount ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  All {activeCart.slotCount} slots are full. Generate the route to put away, then create a new cart.
                </p>
              ) : (
                <form onSubmit={addForm.handleSubmit(onAddLine)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="Item SKU"
                      id="sku"
                      placeholder="Scan or type SKU…"
                      error={addForm.formState.errors.sku?.message}
                      autoFocus
                      {...addForm.register('sku')}
                    />
                    <Input label="Quantity" id="qty" type="number" error={addForm.formState.errors.qty?.message} {...addForm.register('qty')} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Lot Code (optional)" id="lot_code" {...addForm.register('lot_code')} />
                    <Select label="Stock Category" id="stock_category" error={addForm.formState.errors.stock_category?.message} {...addForm.register('stock_category')}>
                      {cats?.results.map(c => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </Select>
                  </div>
                  {addError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{addError}</p>
                  )}
                  <div className="flex justify-end">
                    <Button type="submit" loading={isAdding}>
                      <Plus className="h-4 w-4" /> Add to Slot {activeCart.slotPrefix}{activeCart.nextSlot}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Cart contents */}
          {activeCart.lines.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <ShoppingCart className="h-4 w-4 inline mr-2" />
                  {activeCart.lines.length} item{activeCart.lines.length !== 1 ? 's' : ''} on cart
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Slot</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">SKU</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Item</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Qty</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Target Bin</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">WH</th>
                      <th className="px-4 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeCart.lines.map(line => (
                      <tr key={line.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <span className="inline-block rounded-md bg-primary-100 px-2 py-0.5 font-mono font-bold text-primary-700 text-xs">
                            {line.slot}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono font-medium text-slate-900">{line.sku}</td>
                        <td className="px-4 py-2 text-slate-600 truncate max-w-[160px]">{line.item.name}</td>
                        <td className="px-4 py-2 text-right font-semibold">{line.qty}</td>
                        <td className="px-4 py-2">
                          {line.suggestedBin
                            ? <span className="font-mono text-primary-700">{line.suggestedBin.location_code}</span>
                            : <span className="text-xs text-amber-500 italic">{activeCart.mode === 'manual' ? '—' : 'No bin'}</span>}
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
                  {noBinLines > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {noBinLines} item{noBinLines !== 1 ? 's have' : ' has'} no assigned bin
                    </span>
                  )}
                  <Button className="ml-auto" onClick={() => setPhase('route')} disabled={pendingLines === 0}>
                    <Route className="h-4 w-4" /> Generate Route
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── ROUTE PHASE ────────────────────────────────────────────────── */}
      {phase === 'route' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">{doneLines} / {totalLines} lines put away</p>
            <div className="flex gap-2 items-center">
              {allDone ? (
                <span className="flex items-center gap-2 text-green-600 font-semibold text-sm">
                  <CheckCircle2 className="h-5 w-5" /> All done!
                </span>
              ) : (
                <Button loading={isPuttingAway} onClick={putAwayAll}>Put Away All</Button>
              )}
            </div>
          </div>

          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300"
              style={{ width: totalLines > 0 ? `${(doneLines / totalLines) * 100}%` : '0%' }}
            />
          </div>

          <div className="space-y-3">
            {routeGroups.map((group, gi) => (
              <Card key={gi} className={cn(group.lines.every(l => l.status === 'done') && 'opacity-50')}>
                {/* Bin header */}
                <div className={cn(
                  'flex items-center gap-3 px-4 py-2.5 border-b rounded-t-lg',
                  group.bin ? 'bg-primary-50 border-primary-100' : 'bg-amber-50 border-amber-100'
                )}>
                  <span className="text-xs font-bold text-slate-400 w-5 text-right">{gi + 1}</span>
                  {group.bin ? (
                    <>
                      <span className="font-mono font-bold text-primary-800 text-lg">{group.bin.location_code}</span>
                      {group.bin.warehouse_code && (
                        <span className="text-xs text-primary-400">({group.bin.warehouse_code})</span>
                      )}
                    </>
                  ) : (
                    <span className="text-amber-600 font-medium text-sm flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> No bin assigned
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-400">{group.lines.length} item{group.lines.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Items for this bin */}
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
                        {/* Slot badge — most prominent element for the worker */}
                        <td className="px-4 py-3 w-16">
                          <span className="inline-block rounded-lg bg-primary-600 px-2.5 py-1 font-mono font-bold text-white text-sm">
                            {line.slot}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-medium text-slate-900">{line.sku}</td>
                        <td className="px-4 py-3 text-slate-600">{line.item.name}</td>
                        <td className="px-4 py-3 text-right font-bold text-lg text-slate-800 w-16">{line.qty}</td>
                        <td className="px-4 py-3 text-right w-28">
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
