import { Fragment } from 'react'
import { NavLink } from 'react-router-dom'
import { Layers, ChevronLeft } from 'lucide-react'
import { navItems } from '../navigation'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onNavigate: () => void
}

export default function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onNavigate }: SidebarProps) {
  return (
    <aside className={`sidebar${mobileOpen ? ' is-open' : ''}`}>
      <div className="brand">
        <Layers size={18} strokeWidth={2.25} />
        <span className="brand-name">CapitalWise</span>
      </div>

      <div className="nav-heading" aria-hidden="true">MENU</div>
      <nav className="nav">
        {navItems.map(({ label, path, icon: Icon, children }) => (
          <Fragment key={path}>
            <NavLink
              to={path}
              end={path === '/' || !!children}
              title={collapsed ? label : undefined}
              className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              onClick={onNavigate}
            >
              <Icon size={18} strokeWidth={1.75} />
              <span className="nav-label">{label}</span>
            </NavLink>
            {children && (
              <div className="nav-children">
                {children.map(({ label: childLabel, path: childPath, icon: ChildIcon }) => (
                  <NavLink
                    key={childPath}
                    to={childPath}
                    title={collapsed ? childLabel : undefined}
                    className={({ isActive }) => `nav-link nav-child${isActive ? ' is-active' : ''}`}
                    onClick={onNavigate}
                  >
                    <ChildIcon size={16} strokeWidth={1.75} />
                    <span className="nav-label">{childLabel}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </Fragment>
        ))}
      </nav>

      <button
        className="collapse-toggle"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft size={14} />
      </button>
    </aside>
  )
}
