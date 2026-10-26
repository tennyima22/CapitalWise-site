import {
  LayoutDashboard,
  Box,
  CalendarClock,
  ClipboardCheck,
  Building2,
  FileChartColumn,
  History,
  Users,
  Settings,
  Download,
  Upload,
  Archive,
  type LucideIcon,
} from 'lucide-react'

export interface NavChild {
  label: string
  path: string
  icon: LucideIcon
}

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  description: string
  children?: NavChild[]
}

export const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, description: 'Overview of your fixed assets, value and upcoming activity.' },
  { label: 'Asset Register', path: '/assets', icon: Box, description: 'Every asset with its location, owner, replacement cost and replacement schedule.' },
  { label: 'Capital Reserve Plan', path: '/capital-reserve', icon: CalendarClock, description: 'Forecast replacements and plan reserve funding over time.' },
  { label: 'Physical Inventory', path: '/inventory', icon: ClipboardCheck, description: 'Run counts and verify assets against the register.' },
  { label: 'Departments & Locations', path: '/departments', icon: Building2, description: 'View and manage the assets assigned to each department.' },
  { label: 'Reports', path: '/reports', icon: FileChartColumn, description: 'Depreciation schedules, additions, disposals and more.',
    children: [
      { label: 'Export', path: '/reports/export', icon: Download },
      { label: 'Import', path: '/reports/import', icon: Upload },
      { label: 'Disposals & Deletions', path: '/reports/disposals', icon: Archive },
    ],
  },
  { label: 'Change Log & Approvals', path: '/change-log', icon: History, description: 'Audit trail of changes and items awaiting approval.' },
  { label: 'Users & Access', path: '/users', icon: Users, description: 'Invite users, assign roles and manage account access.' },
  { label: 'Settings', path: '/settings', icon: Settings, description: 'Organization, depreciation methods, categories and users.' },
]
