import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/AppShell'
import CustomersPage from './pages/CustomersPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import PlaceholderPage from './pages/PlaceholderPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/customers" replace />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="schedule" element={<PlaceholderPage title="Schedule" />} />
        <Route path="invoices" element={<PlaceholderPage title="Invoices" />} />
        <Route path="commission" element={<PlaceholderPage title="Commission" />} />
        <Route path="inventory" element={<PlaceholderPage title="Inventory" />} />
        <Route path="reports" element={<PlaceholderPage title="Reports" />} />
        <Route path="settings" element={<PlaceholderPage title="Settings" />} />
      </Route>
    </Routes>
  )
}
