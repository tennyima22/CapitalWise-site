import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Avatar from '../components/Avatar'
import { useAuth } from '../auth/authContext'
import { DEPARTMENTS, departmentsInUse } from '../data/departments'
import { isAdministrator } from '../data/lifecycle'
import { ROLE_DESCRIPTIONS, normalizeRole, syncProfile } from '../data/users'
import { loadAssets } from '../data/assets'

export default function Account() {
  const { user, updateUser } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [organization, setOrganization] = useState(user?.organization ?? '')
  const [department, setDepartment] = useState(user?.department ?? '')
  const [saved, setSaved] = useState(false)

  if (!user) return null

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const changes = { name: name.trim() || user.name, department: department || undefined }
    updateUser({ ...changes, organization: organization.trim() })
    syncProfile(user.email, changes)
    setSaved(true)
  }

  return (
    <>
      <PageHeader title="My account" description="Your profile and sign-in details." />
      <div className="card">
        <div className="account-summary">
          <Avatar name={user.name} size={56} />
          <div>
            <div className="account-summary-name">{user.name}</div>
            <div className="account-email">{user.email}</div>
            <span className="badge">{user.role}</span>
          </div>
        </div>

        <form className="account-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Full name</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} />
          </label>
          <label className="field">
            <span>Email</span>
            <input value={user.email} disabled />
          </label>
          <label className="field">
            <span>Organization</span>
            <input value={organization} onChange={(e) => { setOrganization(e.target.value); setSaved(false) }} />
          </label>
          <label className="field">
            <span>Role</span>
            <input value={user.role} disabled />
            <span className="field-hint">
              {ROLE_DESCRIPTIONS[normalizeRole(user.role)]}
              {' '}{isAdministrator(user.role) ? <>Manage roles on the <Link to="/users">Users</Link> page.</> : 'Roles are assigned by an Admin.'}
            </span>
          </label>
          <label className="field">
            <span>My department</span>
            <select value={department} onChange={(e) => { setDepartment(e.target.value); setSaved(false) }}>
              <option value="">None</option>
              {[...new Set([...DEPARTMENTS, ...departmentsInUse(loadAssets())])].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <div className="form-actions">
            {saved && <span className="saved-note">Saved</span>}
            <button className="button primary" type="submit">Save changes</button>
          </div>
        </form>
      </div>
    </>
  )
}
