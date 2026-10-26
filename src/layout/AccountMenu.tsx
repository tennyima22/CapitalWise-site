import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react'
import { useAuth } from '../auth/authContext'
import Avatar from '../components/Avatar'

export default function AccountMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  const close = () => setOpen(false)

  const signOut = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="account" ref={ref}>
      <button className="account-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={user.name} />
        <span className="account-trigger-text">
          <span className="account-name">{user.name}</span>
          <span className="account-role">{user.role}</span>
        </span>
        <ChevronDown size={16} className="account-chevron" />
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-header">
            <Avatar name={user.name} size={40} />
            <div className="account-menu-identity">
              <div className="account-name">{user.name}</div>
              <div className="account-email">{user.email}</div>
              <div className="account-email">{user.organization}</div>
            </div>
          </div>
          <Link to="/account" className="menu-item" role="menuitem" onClick={close}>
            <UserRound size={16} /> My account
          </Link>
          <Link to="/settings" className="menu-item" role="menuitem" onClick={close}>
            <Settings size={16} /> Settings
          </Link>
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" onClick={signOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
