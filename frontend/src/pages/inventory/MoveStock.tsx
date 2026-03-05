import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { quantsApi, binsApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Quant, Bin } from '@/types'

const schema = z.object({
  from_quant_id: z.coerce.number().min(1, 'Select a source quant'),
  target_bin_id: z.coerce.number().min(1, 'Select a target bin'),
  qty: z.coerce.number().min(1, 'Qty must be ≥ 1'),
})
type FormData = z.infer<typeof schema>

export default function MoveStock() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState<{ qty: number; from: string; to: string } | null>(null)

  const { data: quants, isLoading: quantsLoading } = useQuery({
    queryKey: ['quants-all'],
    queryFn: () => quantsApi.list({ page_size: 1000 }),
  })
  const { data: bins } = useQuery({
    queryKey: ['bins-all'],
    queryFn: () => binsApi.list({ page_size: 1000 }),
  })

  const mutation = useMutation({
    mutationFn: quantsApi.transferToBin,
    onSuccess: (_, vars: FormData) => {
      const fromQuant = quants?.results.find((q: Quant) => q.id === Number(vars.from_quant_id))
      const toBin = bins?.results.find((b: Bin) => b.id === Number(vars.target_bin_id))
      setSuccess({
        qty: vars.qty,
        from: fromQuant?.bin_location ?? `Quant #${vars.from_quant_id}`,
        to: toBin?.location_code ?? `Bin #${vars.target_bin_id}`,
      })
      qc.invalidateQueries({ queryKey: ['quants'] })
      reset()
    },
  })

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const selectedQuantId = watch('from_quant_id')
  const selectedQuant = quants?.results.find((q: Quant) => q.id === Number(selectedQuantId))

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Move Stock</h1>
        <p className="mt-1 text-sm text-slate-500">Transfer quantity from one bin to another</p>
      </div>

      {success && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-green-700">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            Moved <strong>{success.qty}</strong> units from <strong>{success.from}</strong> → <strong>{success.to}</strong>
          </p>
          <button onClick={() => setSuccess(null)} className="ml-auto text-xs underline">Move more</button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Transfer</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-5">

            {/* Source quant */}
            <Select
              label="Source Quant (item + bin)"
              id="from_quant_id"
              error={errors.from_quant_id?.message}
              {...register('from_quant_id')}
            >
              <option value="">Select source…</option>
              {quantsLoading && <option disabled>Loading…</option>}
              {quants?.results.map((q: Quant) => (
                <option key={q.id} value={q.id}>
                  {q.item_sku} — {q.bin_location} ({q.bin_warehouse_code}) · {q.qty_available} available
                </option>
              ))}
            </Select>

            {/* Source quant details */}
            {selectedQuant && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-slate-500">Item</p>
                  <p className="font-mono font-medium">{selectedQuant.item_sku}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Bin</p>
                  <p className="font-medium">{selectedQuant.bin_location}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Available</p>
                  <p className="font-semibold text-green-600">{selectedQuant.qty_available}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Category</p>
                  <p className="font-mono text-xs">{selectedQuant.stock_category}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Lot</p>
                  <p>{selectedQuant.lot_code ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Owner</p>
                  <p>{selectedQuant.owner_name}</p>
                </div>
              </div>
            )}

            {/* Arrow + qty */}
            <div className="flex items-center gap-4">
              <Input
                label="Qty to move"
                id="qty"
                type="number"
                error={errors.qty?.message}
                {...register('qty')}
              />
              <ArrowRight className="h-5 w-5 text-slate-400 mt-5 shrink-0" />
              <Select
                label="Target Bin"
                id="target_bin_id"
                error={errors.target_bin_id?.message}
                {...register('target_bin_id')}
              >
                <option value="">Select target bin…</option>
                {bins?.results
                  .filter((b: Bin) => b.active && b.id !== selectedQuant?.bin)
                  .map((b: Bin) => (
                    <option key={b.id} value={b.id}>
                      {b.location_code} ({b.warehouse_code})
                    </option>
                  ))}
              </Select>
            </div>

            {mutation.isError && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
                {(mutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error
                  ?? 'Transfer failed'}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending}>
                Move Stock
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
