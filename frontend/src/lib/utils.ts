import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'dd MMM yyyy HH:mm')
  } catch {
    return iso
  }
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'dd MMM yyyy')
  } catch {
    return iso
  }
}

export const DOC_TYPE_LABELS: Record<number, string> = {
  100: 'Outbound Order',
  110: 'Transfer Order',
  120: 'Inbound Receipt',
  130: 'Adjustment',
}

export const DOC_STATUS_LABELS: Record<number, string> = {
  10: 'Draft',
  20: 'Pending',
  30: 'Partially Allocated',
  40: 'Fully Allocated',
  50: 'Partially Picked',
  60: 'Fully Picked',
  70: 'Completed',
  80: 'Canceled',
}

export const DOC_STATUS_COLORS: Record<number, string> = {
  10: 'bg-slate-100 text-slate-700',
  20: 'bg-yellow-100 text-yellow-700',
  30: 'bg-orange-100 text-orange-700',
  40: 'bg-blue-100 text-blue-700',
  50: 'bg-indigo-100 text-indigo-700',
  60: 'bg-violet-100 text-violet-700',
  70: 'bg-green-100 text-green-700',
  80: 'bg-red-100 text-red-700',
}

export const LOG_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  SUCCESS: 'bg-green-100 text-green-700',
  PARTIAL: 'bg-orange-100 text-orange-700',
  FAILED: 'bg-red-100 text-red-700',
}

export const DELIVERY_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  SENT: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
}
