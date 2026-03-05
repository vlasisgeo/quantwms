import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Layout } from '@/components/layout/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Items from '@/pages/inventory/Items'
import Stock from '@/pages/inventory/Stock'
import ReceiveGoods from '@/pages/inventory/ReceiveGoods'
import Movements from '@/pages/inventory/Movements'
import Documents from '@/pages/orders/Documents'
import DocumentDetail from '@/pages/orders/DocumentDetail'
import FulfilOrder from '@/pages/orders/FulfilOrder'
import FulfilmentLogs from '@/pages/orders/FulfilmentLogs'
import Companies from '@/pages/warehouse/Companies'
import Warehouses from '@/pages/warehouse/Warehouses'
import Bins from '@/pages/warehouse/Bins'
import Sections from '@/pages/warehouse/Sections'
import Integrations from '@/pages/erp/Integrations'
import InboundEvents from '@/pages/erp/InboundEvents'
import Deliveries from '@/pages/erp/Deliveries'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
      </div>
    )
  }
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />

        <Route path="inventory/items" element={<Items />} />
        <Route path="inventory/stock" element={<Stock />} />
        <Route path="inventory/receive" element={<ReceiveGoods />} />
        <Route path="inventory/movements" element={<Movements />} />

        <Route path="orders/documents" element={<Documents />} />
        <Route path="orders/documents/:id" element={<DocumentDetail />} />
        <Route path="orders/fulfil" element={<FulfilOrder />} />
        <Route path="orders/logs" element={<FulfilmentLogs />} />

        <Route path="warehouse/companies" element={<Companies />} />
        <Route path="warehouse/warehouses" element={<Warehouses />} />
        <Route path="warehouse/bins" element={<Bins />} />
        <Route path="warehouse/sections" element={<Sections />} />

        <Route path="erp/integrations" element={<Integrations />} />
        <Route path="erp/events" element={<InboundEvents />} />
        <Route path="erp/deliveries" element={<Deliveries />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
