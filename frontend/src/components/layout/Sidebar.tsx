import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Package, Boxes, ArrowLeftRight, Building2,
  Warehouse, MapPin, Layers, FileText, ClipboardList, History,
  Plug, Radio, Send, LogOut, ChevronDown, ChevronRight, BookOpen,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

interface NavGroup {
  label: string
  icon: React.ReactNode
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    label: 'Warehouse',
    icon: <Building2 className="h-4 w-4" />,
    items: [
      { to: '/warehouse/companies', label: 'Companies', icon: <Building2 className="h-4 w-4" /> },
      { to: '/warehouse/warehouses', label: 'Warehouses', icon: <Warehouse className="h-4 w-4" /> },
      { to: '/warehouse/bins', label: 'Bins', icon: <MapPin className="h-4 w-4" /> },
      { to: '/warehouse/sections', label: 'Sections', icon: <Layers className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Inventory',
    icon: <Boxes className="h-4 w-4" />,
    items: [
      { to: '/inventory/items', label: 'Items', icon: <Package className="h-4 w-4" /> },
      { to: '/inventory/stock', label: 'Stock', icon: <Boxes className="h-4 w-4" /> },
      { to: '/inventory/receive', label: 'Receive Goods', icon: <ArrowLeftRight className="h-4 w-4" /> },
      { to: '/inventory/movements', label: 'Movements', icon: <History className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Orders',
    icon: <FileText className="h-4 w-4" />,
    items: [
      { to: '/orders/documents', label: 'Documents', icon: <FileText className="h-4 w-4" /> },
      { to: '/orders/fulfil', label: 'New Order', icon: <ClipboardList className="h-4 w-4" /> },
      { to: '/orders/logs', label: 'Fulfilment Logs', icon: <BookOpen className="h-4 w-4" /> },
    ],
  },
  {
    label: 'ERP Connector',
    icon: <Plug className="h-4 w-4" />,
    items: [
      { to: '/erp/integrations', label: 'Integrations', icon: <Plug className="h-4 w-4" /> },
      { to: '/erp/events', label: 'Inbound Events', icon: <Radio className="h-4 w-4" /> },
      { to: '/erp/deliveries', label: 'Deliveries', icon: <Send className="h-4 w-4" /> },
    ],
  },
]

function NavGroup({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600 transition-colors"
      >
        <span className="flex items-center gap-2">
          {group.icon}
          {group.label}
        </span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { user, logout } = useAuth()

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-slate-200 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-5 border-b border-slate-100">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
          <Boxes className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-bold text-slate-900">QuantWMS</span>
      </div>

      {/* Dashboard link */}
      <div className="px-3 pt-4 pb-2">
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary-50 text-primary-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            )
          }
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </NavLink>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
        {groups.map((g) => (
          <NavGroup key={g.label} group={g} />
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-slate-100 px-3 py-3">
        <div className="flex items-center justify-between rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{user?.username}</p>
            <p className="text-xs text-slate-400">{user?.is_staff ? 'Admin' : 'Staff'}</p>
          </div>
          <button
            onClick={logout}
            className="ml-2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-500 transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
