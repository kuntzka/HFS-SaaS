import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import CustomersPage from './pages/CustomersPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import PlaceholderPage from './pages/PlaceholderPage'
import SchedulePage from './pages/SchedulePage'
import InvoicesPage from './pages/InvoicesPage'
import CommissionsPage from './pages/CommissionsPage'
import InventoryPage from './pages/InventoryPage'
import EmployeesPage from './pages/EmployeesPage'
import ReportsPage from './pages/ReportsPage'
import ExportPage from './pages/ExportPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/customers" replace />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="schedule"   element={<SchedulePage />} />
          <Route path="invoices"   element={<InvoicesPage />} />
          <Route path="commission" element={<CommissionsPage />} />
          <Route path="inventory"  element={<InventoryPage />} />
          <Route path="employees"  element={<EmployeesPage />} />
          <Route path="reports"    element={<ReportsPage />} />
          <Route path="export"     element={<ExportPage />} />
          <Route path="settings"   element={<PlaceholderPage title="Settings" />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
