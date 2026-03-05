import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Boxes } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})
type FormData = z.infer<typeof schema>

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError('')
    try {
      await login(data.username, data.password)
      navigate('/dashboard')
    } catch {
      setError('Invalid username or password')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600 shadow-lg mb-4">
            <Boxes className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">QuantWMS</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <Input
              label="Username"
              id="username"
              placeholder="admin"
              error={errors.username?.message}
              {...register('username')}
            />
            <Input
              label="Password"
              id="password"
              type="password"
              placeholder="••••••••"
              error={errors.password?.message}
              {...register('password')}
            />
            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
            )}
            <Button type="submit" loading={isSubmitting} className="w-full">
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
