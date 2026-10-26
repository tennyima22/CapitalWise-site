import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import Dashboard from './pages/Dashboard'
import PlaceholderPage from './pages/PlaceholderPage'
import Login from './pages/Login'
import Account from './pages/Account'
import RequireAuth from './auth/RequireAuth'
import AssetRegister from './pages/assets/AssetRegister'
import CapitalReservePlan from './pages/capitalReserve/CapitalReservePlan'
import Departments from './pages/departments/Departments'
import Reports from './pages/reports/Reports'
import Export from './pages/reports/Export'
import Import from './pages/reports/Import'
import Disposals from './pages/reports/Disposals'
import Settings from './pages/Settings'
import ChangeLog from './pages/ChangeLog'
import Users from './pages/users/Users'
import { navItems } from './navigation'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="/account" element={<Account />} />
        <Route path="/assets" element={<AssetRegister />} />
        <Route path="/capital-reserve" element={<CapitalReservePlan />} />
        <Route path="/departments" element={<Departments />} />
        <Route path="/departments/:slug" element={<Departments />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/export" element={<Export />} />
        <Route path="/reports/import" element={<Import />} />
        <Route path="/reports/disposals" element={<Disposals />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/change-log" element={<ChangeLog />} />
        <Route path="/users" element={<Users />} />
        {navItems
          .filter((item) => !['/', '/assets', '/capital-reserve', '/reports', '/departments', '/settings', '/change-log', '/users'].includes(item.path))
          .map((item) => (
            <Route key={item.path} path={item.path} element={<PlaceholderPage item={item} />} />
          ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      </Route>
    </Routes>
  )
}
