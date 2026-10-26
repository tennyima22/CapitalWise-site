import { createContext, useContext } from 'react'

export interface User {
  name: string
  email: string
  role: string
  organization: string
  /** The department this user owns assets for, if any. */
  department?: string
}

export interface AuthContextValue {
  user: User | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  updateUser: (changes: Partial<User>) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
