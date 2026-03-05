import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: CardProps) {
  return (
    <div className={cn('flex items-center justify-between px-6 py-4 border-b border-slate-100', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className }: CardProps) {
  return <h3 className={cn('text-base font-semibold text-slate-900', className)}>{children}</h3>
}

export function CardContent({ children, className }: CardProps) {
  return <div className={cn('p-6', className)}>{children}</div>
}
