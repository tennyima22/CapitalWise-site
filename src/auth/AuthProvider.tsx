import { useState, type ReactNode } from 'react'
import { AuthContext, type User } from './authContext'
import { findUser, loadUsers, normalizeRole, signInUser } from '../data/users'

const STORAGE_KEY = 'capitalwise.user'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The saved session, checked against the user directory: the role always comes from the
 * directory, and a disabled or removed user is signed out.
 */
function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as User
    // Sessions from before the Users page existed: that person sets up the directory as its Admin.
    if (loadUsers().length === 0) return { ...saved, ...pick(signInUser(saved.email, saved.name)) }
    const member = findUser(saved.email)
    if (!member || member.status === 'Disabled') return null
    return { ...saved, role: normalizeRole(member.role) }
  } catch {
    return null
  }
}

const pick = (u: { name: string; role: string; department?: string }) => ({ name: u.name, role: u.role, department: u.department })

function saveUser(user: User | null) {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (e.g. private mode): the session lasts until reload.
  }
}

function nameFromEmail(email: string) {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadUser)

  const set = (next: User | null) => {
    setUser(next)
    saveUser(next)
  }

  // Placeholder sign-in: any password is accepted until a real backend exists, but the email must
  // be invited and enabled on the Users page (the first person to sign in becomes the Admin).
  const login = async (email: string, password: string) => {
    if (!email || !password) throw new Error('Enter your email and password.')
    if (!EMAIL_PATTERN.test(email)) throw new Error('Enter a valid email address.')
    const member = signInUser(email, nameFromEmail(email) || 'User')
    set({
      email: member.email,
      organization: 'My Organization',
      ...pick(member),
    })
  }

  const logout = () => set(null)

  const updateUser = (changes: Partial<User>) => {
    if (user) set({ ...user, ...changes })
  }

  return <AuthContext.Provider value={{ user, login, logout, updateUser }}>{children}</AuthContext.Provider>
}
