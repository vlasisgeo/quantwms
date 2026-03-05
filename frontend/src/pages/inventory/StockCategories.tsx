import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { stockCategoriesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import type { StockCategory } from '@/types'

const schema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
})
type FormData = z.infer<typeof schema>

export default function StockCategories() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.is_staff
  const [modal, setModal] = useState<null | 'create' | StockCategory>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['stock-categories'],
    queryFn: () => stockCategoriesApi.list(),
  })

  const createMutation = useMutation({
    mutationFn: stockCategoriesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-categories'] }); setModal(null) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ code, ...d }: Partial<StockCategory> & { code: string }) =>
      stockCategoriesApi.update(code, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-categories'] }); setModal(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: stockCategoriesApi.destroy,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-categories'] }); setModal(null) },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  function openCreate() {
    reset({ code: '', name: '', description: '' })
    setModal('create')
  }

  function openEdit(sc: StockCategory) {
    reset({ code: sc.code, name: sc.name, description: sc.description })
    setModal(sc)
  }

  function onSubmit(d: FormData) {
    if (modal === 'create') {
      createMutation.mutate(d)
    } else if (modal && typeof modal === 'object') {
      updateMutation.mutate({ code: modal.code, name: d.name, description: d.description })
    }
  }

  const isEdit = modal && typeof modal === 'object'

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Stock Categories</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data?.count ?? 0} categories · {isAdmin ? 'Admin — full access' : 'Read-only'}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Category
          </Button>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>All Stock Categories</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r: StockCategory) => r.code}
            onRowClick={isAdmin ? openEdit : undefined}
            data={data?.results ?? []}
            columns={[
              { key: 'code', header: 'Code', render: (r: StockCategory) => <span className="font-mono font-medium">{r.code}</span> },
              { key: 'name', header: 'Name' },
              { key: 'description', header: 'Description', render: (r: StockCategory) => r.description || '—' },
            ]}
          />
        </CardContent>
      </Card>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={isEdit ? 'Edit Stock Category' : 'New Stock Category'}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Code"
            id="code"
            placeholder="UNRESTRICTED"
            error={errors.code?.message}
            disabled={!!isEdit}
            {...register('code')}
          />
          <Input
            label="Name"
            id="name"
            placeholder="Unrestricted"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Description"
            id="description"
            placeholder="Standard usable stock"
            {...register('description')}
          />
          <div className="flex items-center justify-between pt-2">
            {isEdit && (
              <Button
                type="button"
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate((modal as StockCategory).code)}
              >
                Delete
              </Button>
            )}
            <div className="flex gap-3 ml-auto">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="submit" loading={createMutation.isPending || updateMutation.isPending}>
                {isEdit ? 'Save' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
