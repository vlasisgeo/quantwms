import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { documentsApi, warehousesApi, companiesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LOG_STATUS_COLORS } from '@/lib/utils'

const lineSchema = z.object({
  item_sku: z.string().min(1, 'SKU required'),
  qty_requested: z.coerce.number().min(1, 'Min 1'),
  price: z.string().optional(),
})

const schema = z.object({
  doc_number: z.string().min(1, 'Required'),
  warehouse_id: z.coerce.number().min(1, 'Select a warehouse'),
  owner_id: z.coerce.number().min(1, 'Select an owner'),
  erp_doc_number: z.string().optional(),
  notes: z.string().optional(),
  reserve: z.boolean().optional(),
  strategy: z.enum(['FIFO', 'FEFO']).optional(),
  lines: z.array(lineSchema).min(1, 'At least one line required'),
})
type FormData = z.infer<typeof schema>

export default function FulfilOrder() {
  const navigate = useNavigate()
  const [result, setResult] = useState<{ log_id: number; status: string; allocation?: unknown } | null>(null)

  const { data: warehouses } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() })
  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() })

  const mutation = useMutation({
    mutationFn: documentsApi.fulfil,
    onSuccess: (data) => {
      setResult({
        log_id: data.log_id,
        status: data.document.status === 70 ? 'SUCCESS' : data.allocation ? 'PARTIAL' : 'SUCCESS',
        allocation: data.allocation,
      })
    },
  })

  const { register, control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      strategy: 'FIFO',
      reserve: true,
      lines: [{ item_sku: '', qty_requested: 1, price: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })

  if (result) {
    return (
      <div className="p-8 max-w-lg">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Order Created</h2>
          <div className="flex items-center justify-center gap-2 mb-6">
            <Badge label={result.status} className={LOG_STATUS_COLORS[result.status]} />
            <span className="text-sm text-slate-500">Log #{result.log_id}</span>
          </div>
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" onClick={() => setResult(null)}>Create Another</Button>
            <Button onClick={() => navigate('/orders/documents')}>View Orders</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">New Fulfilment Order</h1>
        <p className="mt-1 text-sm text-slate-500">Create a document and all lines in one call</p>
      </div>

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))}>
        <Card className="mb-5">
          <CardHeader><CardTitle>Order Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Document Number" id="doc_number" placeholder="SO-001" error={errors.doc_number?.message} {...register('doc_number')} />
              <Input label="ERP / Eshop Reference" id="erp_doc_number" placeholder="SHOPIFY-9981" {...register('erp_doc_number')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Warehouse" id="warehouse_id" error={errors.warehouse_id?.message} {...register('warehouse_id')}>
                <option value="">Select warehouse…</option>
                {warehouses?.results.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </Select>
              <Select label="Owner (Company)" id="owner_id" error={errors.owner_id?.message} {...register('owner_id')}>
                <option value="">Select company…</option>
                {companies?.results.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <Input label="Notes" id="notes" {...register('notes')} />
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" {...register('reserve')} className="rounded" />
                Auto-reserve stock
              </label>
              <Select label="" id="strategy" className="h-8 w-32 text-xs" {...register('strategy')}>
                <option value="FIFO">FIFO</option>
                <option value="FEFO">FEFO</option>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Order Lines</CardTitle>
            <Button type="button" size="sm" variant="secondary" onClick={() => append({ item_sku: '', qty_requested: 1, price: '' })}>
              <Plus className="h-4 w-4" /> Add Line
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {fields.map((field, idx) => (
              <div key={field.id} className="flex items-start gap-3">
                <div className="flex h-7 w-7 mt-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 grid grid-cols-3 gap-3">
                  <Input
                    label="Item SKU"
                    placeholder="SKU-001"
                    error={errors.lines?.[idx]?.item_sku?.message}
                    {...register(`lines.${idx}.item_sku`)}
                  />
                  <Input
                    label="Quantity"
                    type="number"
                    min="1"
                    error={errors.lines?.[idx]?.qty_requested?.message}
                    {...register(`lines.${idx}.qty_requested`)}
                  />
                  <Input
                    label="Price"
                    placeholder="19.99"
                    {...register(`lines.${idx}.price`)}
                  />
                </div>
                {fields.length > 1 && (
                  <button type="button" onClick={() => remove(idx)} className="mt-6 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {errors.lines?.root && <p className="text-xs text-red-500">{errors.lines.root.message}</p>}
          </CardContent>
        </Card>

        {mutation.isError && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {(mutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create order'}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => navigate('/orders/documents')}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Create Order</Button>
        </div>
      </form>
    </div>
  )
}
