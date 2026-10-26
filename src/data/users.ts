import { ROLES, type Role } from './lifecycle'
import { appendAudit, entry, type Actor } from './audit'

/** Invited: added by an Admin but not signed in yet. Disabled: can no longer sign in. */
export type UserStatus = 'Active' | 'Invited' | 'Disabled'

/** A person with access to the register, as managed on the Users page. */
export interface ManagedUser {
  email: string
  name: string
  role: Role
  status: UserStatus
  department?: string
  invitedBy?: string
  invitedAt?: string
  lastSignInAt?: string
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Staff: 'Add and edit assets, flag them and request disposals. Can’t approve.',
  'Asset Manager': 'Everything Staff can do, plus approve new assets and disposals, and cancel or restore records.',
  'Finance Controller': 'Same approvals as an Asset Manager, for finance sign-off.',
  Admin: 'Full access: approvals, managing users and roles, replacing the register on import and deleting all assets.',
}

const STORAGE_KEY = 'capitalwise.users'

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Map role names from earlier versions ("Administrator", "Finance Approver") to the current ones. */
export function normalizeRole(role: string | undefined): Role {
  if (role === 'Administrator') return 'Admin'
  if (role === 'Finance Approver') return 'Finance Controller'
  return (ROLES as readonly string[]).includes(role ?? '') ? (role as Role) : 'Staff'
}

export function loadUsers(): ManagedUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ManagedUser[]).map((u) => ({ ...u, role: normalizeRole(u.role) })) : []
  } catch {
    return []
  }
}

function saveUsers(users: ManagedUser[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users))
  } catch {
    // Storage unavailable: changes last only for this page load.
  }
}

export const findUser = (email: string, users = loadUsers()) => users.find((u) => sameEmail(u.email, email))

const activeAdmins = (users: ManagedUser[]) => users.filter((u) => u.role === 'Admin' && u.status === 'Active')

/**
 * Sign-in check. The very first person to sign in sets up the organization and becomes its Admin;
 * after that only invited, enabled users get in. Returns the user with their assigned role.
 */
export function signInUser(email: string, fallbackName: string): ManagedUser {
  const users = loadUsers()
  const now = new Date().toISOString()
  const existing = findUser(email, users)

  if (!existing) {
    if (users.length > 0) throw new Error('This email hasn’t been invited. Ask an Admin to invite you from the Users page.')
    const first: ManagedUser = { email, name: fallbackName, role: 'Admin', status: 'Active', lastSignInAt: now }
    saveUsers([first])
    return first
  }
  if (existing.status === 'Disabled') throw new Error('This account has been disabled. Contact your Admin.')

  const updated: ManagedUser = { ...existing, status: 'Active', lastSignInAt: now }
  saveUsers(users.map((u) => (u === existing ? updated : u)))
  return updated
}

/** Keep a signed-in profile's name and department in the directory in step with the Account page. */
export function syncProfile(email: string, changes: Pick<ManagedUser, 'name'> & { department?: string }) {
  const users = loadUsers()
  if (!findUser(email, users)) return
  saveUsers(users.map((u) => (sameEmail(u.email, email) ? { ...u, ...changes } : u)))
}

const userRecord = (u: Pick<ManagedUser, 'name' | 'email'>) => ({ assetId: '—', assetName: `User: ${u.name} (${u.email})` })

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Add an invited user. Returns an error message, or null when the invite was saved. */
export function inviteUser(input: { name: string; email: string; role: Role; department?: string }, actor: Actor): string | null {
  const email = input.email.trim()
  const name = input.name.trim()
  if (!name) return 'Enter their name.'
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.'
  const users = loadUsers()
  if (findUser(email, users)) return 'Someone with this email already has access.'

  const invited: ManagedUser = { email, name, role: input.role, status: 'Invited', department: input.department || undefined, invitedBy: actor.name, invitedAt: new Date().toISOString() }
  saveUsers([...users, invited])
  appendAudit([entry(actor, userRecord(invited), 'User invited', [{ field: 'Role', from: '—', to: invited.role }])])
  return null
}

/** Change a user's role. Returns an error message, or null when saved. */
export function changeRole(email: string, role: Role, actor: Actor): string | null {
  const users = loadUsers()
  const target = findUser(email, users)
  if (!target) return 'User not found.'
  if (target.role === role) return null
  if (target.role === 'Admin' && activeAdmins(users).length === 1 && target.status === 'Active') return 'This is the only active Admin. Make someone else an Admin first.'

  saveUsers(users.map((u) => (u === target ? { ...u, role } : u)))
  appendAudit([entry(actor, userRecord(target), 'Role changed', [{ field: 'Role', from: target.role, to: role }])])
  return null
}

/** Disable or re-enable a user's access. Returns an error message, or null when saved. */
export function setUserEnabled(email: string, enabled: boolean, actor: Actor): string | null {
  const users = loadUsers()
  const target = findUser(email, users)
  if (!target) return 'User not found.'
  if (!enabled && sameEmail(target.email, actor.email)) return 'You can’t disable your own account.'
  if (!enabled && target.role === 'Admin' && target.status === 'Active' && activeAdmins(users).length === 1) return 'This is the only active Admin. Make someone else an Admin first.'

  // Re-enabled users who never signed in go back to Invited.
  const status: UserStatus = enabled ? (target.lastSignInAt ? 'Active' : 'Invited') : 'Disabled'
  saveUsers(users.map((u) => (u === target ? { ...u, status } : u)))
  appendAudit([entry(actor, userRecord(target), enabled ? 'User enabled' : 'User disabled', [{ field: 'Status', from: target.status, to: status }])])
  return null
}

/** Sign-in link that fills in the invited email. */
export const inviteLink = (email: string) => `${window.location.origin}/login?email=${encodeURIComponent(email)}`

/** A mailto: link with the invitation, opened in the Admin's own email app (there is no mail server yet). */
export function invitationMailto(user: Pick<ManagedUser, 'name' | 'email' | 'role'>, inviterName: string, organization: string) {
  const subject = `You're invited to CapitalWise${organization ? ` for ${organization}` : ''}`
  const body = [
    `Hi ${user.name.split(' ')[0]},`,
    '',
    `${inviterName} has invited you to CapitalWise as ${/^[AEIOU]/.test(user.role) ? 'an' : 'a'} ${user.role}.`,
    '',
    `Sign in with this email address (${user.email}) to set up your account:`,
    inviteLink(user.email),
  ].join('\n')
  return `mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
