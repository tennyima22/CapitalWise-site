import { useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, Copy, Lock, Mail, Search, ShieldCheck, UserCheck, UserPlus, UserX } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import Avatar from '../../components/Avatar'
import Modal from '../../components/Modal'
import { useAuth } from '../../auth/authContext'
import { ROLES, isAdministrator, type Role } from '../../data/lifecycle'
import type { Actor } from '../../data/audit'
import { DEPARTMENTS, departmentsInUse } from '../../data/departments'
import { loadAssets } from '../../data/assets'
import {
  ROLE_DESCRIPTIONS,
  changeRole,
  invitationMailto,
  inviteLink,
  inviteUser,
  loadUsers,
  setUserEnabled,
  type ManagedUser,
  type UserStatus,
} from '../../data/users'

const STATUS_FILTERS: ('All' | UserStatus)[] = ['All', 'Active', 'Invited', 'Disabled']
const STATUS_CLASS: Record<UserStatus, string> = { Active: 'status-active', Invited: 'status-pending', Disabled: 'status-disposed' }

const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export default function Users() {
  const { user, updateUser } = useAuth()
  const actor: Actor = { name: user?.name ?? 'Unknown', email: user?.email ?? '', role: user?.role ?? 'Staff' }
  const admin = isAdministrator(actor.role)

  const [users, setUsers] = useState(loadUsers)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | UserStatus>('All')
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [inviting, setInviting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const reload = () => setUsers(loadUsers())
  const report = (error: string | null, success: string) => setNotice(error ? { tone: 'error', text: error } : { tone: 'ok', text: success })

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: users.length, Active: 0, Invited: 0, Disabled: 0 }
    for (const u of users) c[u.status]++
    return c
  }, [users])

  const visible = users
    .filter((u) => statusFilter === 'All' || u.status === statusFilter)
    .filter((u) => {
      const q = query.trim().toLowerCase()
      return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const onToggle = (u: ManagedUser) => {
    const enable = u.status === 'Disabled'
    if (!enable && !window.confirm(`Disable ${u.name}? They won't be able to sign in until an Admin enables them again.`)) return
    report(setUserEnabled(u.email, enable, actor), `${u.name} was ${enable ? 'enabled' : 'disabled'}.`)
    reload()
  }

  const onRoleSaved = (u: ManagedUser, role: Role) => {
    const error = changeRole(u.email, role, actor)
    report(error, `${u.name} is now ${role === 'Admin' || role === 'Asset Manager' ? 'an' : 'a'} ${role}.`)
    if (!error) {
      if (sameEmail(u.email, actor.email)) updateUser({ role })
      setEditing(null)
    }
    reload()
    return error
  }

  return (
    <>
      <div className="page-header-row">
        <PageHeader title="Users & Access" description="Who can use the register, their roles and account status." />
        {admin && (
          <div className="button-row">
            <button className="button primary with-icon" onClick={() => { setNotice(null); setInviting(true) }}>
              <UserPlus size={16} /> Invite user
            </button>
          </div>
        )}
      </div>

      {!admin && (
        <p className="lifecycle-locked"><Lock size={15} /> You're signed in as {actor.role}. Only an Admin can invite users or change roles and access.</p>
      )}

      {notice && (
        <p className={notice.tone === 'ok' ? 'forecast-ok users-notice' : 'forecast-alert users-notice'}>
          {notice.tone === 'ok' ? <CheckCircle2 size={16} /> : <UserX size={16} />}
          <span>{notice.text}</span>
        </p>
      )}

      <section className="card table-card">
        <div className="table-toolbar">
          <div className="chips" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((s) => (
              <button key={s} className={`chip${statusFilter === s ? ' is-selected' : ''}`} onClick={() => setStatusFilter(s)}>
                {s} <span>{counts[s]}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or role" aria-label="Search users" />
          </label>
        </div>

        <div className="table-wrap flush">
          <table className="table users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Department</th>
                <th>Last sign-in</th>
                {admin && <th className="num">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => {
                const isMe = sameEmail(u.email, actor.email)
                return (
                  <tr key={u.email}>
                    <td>
                      <div className="user-cell">
                        <Avatar name={u.name} size={34} />
                        <div>
                          <div className="cell-strong">{u.name}{isMe && <span className="dept-mine user-you">You</span>}</div>
                          <div className="muted">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={`role-pill role-${u.role.split(' ')[0].toLowerCase()}`}>{u.role}</span></td>
                    <td>
                      <span className={`status-pill ${STATUS_CLASS[u.status]}`}>{u.status}</span>
                      {u.status === 'Invited' && u.invitedAt && <div className="muted">Invited {formatDate(u.invitedAt)}{u.invitedBy ? ` by ${u.invitedBy}` : ''}</div>}
                    </td>
                    <td>{u.department ?? <span className="muted">—</span>}</td>
                    <td className="nowrap">{formatDate(u.lastSignInAt)}</td>
                    {admin && (
                      <td className="num">
                        <div className="user-actions">
                          <button className="button with-icon small" onClick={() => { setNotice(null); setEditing(u) }} disabled={u.status === 'Disabled'} title={u.status === 'Disabled' ? 'Enable the user to change their role' : undefined}>
                            <ShieldCheck size={15} /> Change role
                          </button>
                          {u.status === 'Invited' && (
                            <a className="button with-icon small" href={invitationMailto(u, actor.name, user?.organization ?? '')} title="Open the invitation in your email app">
                              <Mail size={15} /> Resend
                            </a>
                          )}
                          {!isMe && (
                            <button className={`button with-icon small${u.status === 'Disabled' ? '' : ' subtle-danger'}`} onClick={() => onToggle(u)}>
                              {u.status === 'Disabled' ? <><UserCheck size={15} /> Enable</> : <><UserX size={15} /> Disable</>}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr><td colSpan={admin ? 6 : 5} className="table-empty muted">No users match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && <RoleModal user={editing} onClose={() => setEditing(null)} onSave={(role) => onRoleSaved(editing, role)} />}
      {inviting && (
        <InviteModal
          actor={actor}
          organization={user?.organization ?? ''}
          onClose={() => setInviting(false)}
          onInvited={() => reload()}
        />
      )}
    </>
  )
}

function RoleChoices({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  return (
    <fieldset className="choice-group">
      <legend>Role</legend>
      {ROLES.map((r) => (
        <label key={r} className={`choice${value === r ? ' is-selected' : ''}`}>
          <input type="radio" name="role" checked={value === r} onChange={() => onChange(r)} />
          <span>
            <span className="choice-title">{r}</span>
            <span className="choice-text">{ROLE_DESCRIPTIONS[r]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

function RoleModal({ user, onClose, onSave }: { user: ManagedUser; onClose: () => void; onSave: (role: Role) => string | null }) {
  const [role, setRole] = useState<Role>(user.role)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      title={`Change role · ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={role === user.role} onClick={() => setError(onSave(role))}>Save role</button>
        </>
      }
    >
      <div className="form-card">
        <p className="muted">{user.email} · currently <strong>{user.role}</strong>. The change applies the next time they open the register and is recorded in the activity log.</p>
        <RoleChoices value={role} onChange={(r) => { setRole(r); setError(null) }} />
        {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  )
}

function InviteModal({ actor, organization, onClose, onInvited }: { actor: Actor; organization: string; onClose: () => void; onInvited: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('Staff')
  const [department, setDepartment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<ManagedUser | null>(null)
  const [copied, setCopied] = useState(false)
  const departments = useMemo(() => [...new Set([...DEPARTMENTS, ...departmentsInUse(loadAssets())])], [])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const err = inviteUser({ name, email, role, department }, actor)
    setError(err)
    if (err) return
    const invited: ManagedUser = { name: name.trim(), email: email.trim(), role, status: 'Invited' }
    setSent(invited)
    onInvited()
    // Hand the invitation to the Admin's email app, ready to send.
    window.location.href = invitationMailto(invited, actor.name, organization)
  }

  const copyLink = async () => {
    if (!sent) return
    try {
      await navigator.clipboard.writeText(inviteLink(sent.email))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (sent) {
    return (
      <Modal title="Invitation ready" onClose={onClose} footer={<button className="button primary" onClick={onClose}>Done</button>}>
        <div className="form-card">
          <p className="forecast-ok"><CheckCircle2 size={16} /><span><strong>{sent.name}</strong> was added as {sent.role}. They show as <strong>Invited</strong> until they first sign in.</span></p>
          <p className="muted">Your email app should have opened with the invitation filled in; just press send. If it didn't, use one of these:</p>
          <div className="button-row invite-actions">
            <a className="button with-icon" href={invitationMailto(sent, actor.name, organization)}><Mail size={16} /> Open email again</a>
            <button className="button with-icon" onClick={copyLink}><Copy size={16} /> {copied ? 'Link copied' : 'Copy sign-in link'}</button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Invite a user"
      onClose={onClose}
      footer={
        <>
          <button className="button" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary with-icon" type="submit" form="invite-form"><Mail size={16} /> Send invitation</button>
        </>
      }
    >
      <form id="invite-form" className="form-card" onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <label className="field">
            <span>Full name <span className="required">*</span></span>
            <input value={name} onChange={(e) => { setName(e.target.value); setError(null) }} autoFocus />
          </label>
          <label className="field">
            <span>Work email <span className="required">*</span></span>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} placeholder="name@company.com" />
          </label>
          <label className="field">
            <span>Department</span>
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">None</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <RoleChoices value={role} onChange={setRole} />
        {error && <p className="form-error">{error}</p>}
        <p className="muted">Sending opens the invitation in your email app. They sign in with this email address to set up their account.</p>
      </form>
    </Modal>
  )
}
