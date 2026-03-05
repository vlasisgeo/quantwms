import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: ReactNode
  color?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky'
}

const colorMap = {
  indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600', border: 'border-indigo-100' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-100' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600', border: 'border-amber-100' },
  rose: { bg: 'bg-rose-50', icon: 'text-rose-600', border: 'border-rose-100' },
  sky: { bg: 'bg-sky-50', icon: 'text-sky-600', border: 'border-sky-100' },
}

export function StatCard({ title, value, subtitle, icon, color = 'indigo' }: StatCardProps) {
  const c = colorMap[color]
  return (
    <div className={cn('rounded-xl border bg-white p-6 shadow-sm', c.border)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>
        <div className={cn('rounded-xl p-3', c.bg)}>
          <div className={cn('h-6 w-6', c.icon)}>{icon}</div>
        </div>
      </div>
    </div>
  )
}
