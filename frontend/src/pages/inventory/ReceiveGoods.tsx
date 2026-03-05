import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { quantsApi, binsApi, itemsApi, companiesApi, stockCategoriesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

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

export default function ReceiveGoods() {
  const [success, setSuccess] = useState(false)

  const { data: bins } = useQuery({ queryKey: ['bins-all'], queryFn: () => binsApi.list({ page_size: 500 }) })
  const { data: items } = useQuery({ queryKey: ['items-all'], queryFn: () => itemsApi.list({ page_size: 500 }) })
  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() })
  const { data: cats } = useQuery({ queryKey: ['stock-cats'], queryFn: () => stockCategoriesApi.list() })

  const mutation = useMutation({
    mutationFn: quantsApi.receiveGoods,
    onSuccess: () => { setSuccess(true); reset() },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { stock_category: 'UNRESTRICTED', qty: 1 },
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
            <div className="grid grid-cols-2 gap-4">
              <Select label="Bin" id="bin_id" error={errors.bin_id?.message} {...register('bin_id')}>
                <option value="">Select bin…</option>
                {bins?.results.map((b) => (
                  <option key={b.id} value={b.id}>{b.location_code}</option>
                ))}
              </Select>

              <Select label="Item SKU" id="item_sku" error={errors.item_sku?.message} {...register('item_sku')}>
                <option value="">Select item…</option>
                {items?.results.map((i) => (
                  <option key={i.sku} value={i.sku}>{i.sku} — {i.name}</option>
                ))}
              </Select>
            </div>

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
