import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { companiesApi } from '@/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import type { Company } from '@/types'

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
})
type FormData = z.infer<typeof schema>

export default function Companies() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | Company>(null)

  const { data, isLoading } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() })

  const createMutation = useMutation({
    mutationFn: companiesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies'] }); setModal(null) },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: Partial<Company> & { id: number }) => companiesApi.update(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies'] }); setModal(null) },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  function openCreate() { reset({ code: '', name: '' }); setModal('create') }
  function openEdit(c: Company) { reset({ code: c.code, name: c.name }); setModal(c) }

  function onSubmit(d: FormData) {
    if (modal === 'create') createMutation.mutate(d)
    else if (modal && typeof modal === 'object') updateMutation.mutate({ id: modal.id, ...d })
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New Company</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>{data?.count ?? 0} Companies</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table
            loading={isLoading}
            keyExtractor={(r) => r.id}
            onRowClick={openEdit}
            data={data?.results ?? []}
            columns={[
              { key: 'code', header: 'Code', render: (r) => <span className="font-mono font-medium">{r.code}</span> },
              { key: 'name', header: 'Name' },
              { key: 'created_at', header: 'Created', render: (r) => formatDate(r.created_at) },
            ]}
          />
        </CardContent>
      </Card>
      <Modal open={!!modal} onClose={() => setModal(null)} title={typeof modal === 'object' ? 'Edit Company' : 'New Company'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label="Code" id="code" error={errors.code?.message} {...register('code')} />
          <Input label="Name" id="name" error={errors.name?.message} {...register('name')} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending || updateMutation.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
