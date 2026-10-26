import { useMemo, useState } from 'react'
import { Link, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom'
import { Plus, Search, Upload } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import AssetFormModal from './AssetFormModal'
import { effectiveStatus, isCancelled, matchesExpiry, ASSET_STATUSES, loadAssets, replacement, type Asset } from '../../data/assets'
import { diffAssets, entry, type Actor } from '../../data/audit'
import { commit, submitNewAsset } from '../../data/lifecycle'
import StatusModal from '../assets/StatusModal'
import StatusPill, { FlagMark } from '../../components/StatusPill'
import RowActions from '../../components/RowActions'
import ExpiryYearSelect from '../../components/ExpiryYearSelect'
import { departmentFromSlug, departmentSlug, departmentsInUse, matchDepartment } from '../../data/departments'
import { useAuth } from '../../auth/authContext'

const ALL = 'all'
const UNASSIGNED = 'unassigned'
const DUE_SOON_YEARS = 5
const currentYear = new Date().getFullYear()

export default function Departments() {
  const { slug } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [assets, setAssets] = useState(loadAssets)

  const actor: Actor = { name: user?.name ?? 'Unknown', email: user?.email ?? '', role: user?.role ?? 'Staff' }

  /** Save the register and log what changed for every asset that differs from before. */
  const persist = (next: Asset[]) => {
    const before = new Map(assets.map((a) => [a.assetId, a]))
    const entries = next.flatMap((a) => {
      const old = before.get(a.assetId)
      if (old === a) return []
      const changes = diffAssets(old, a)
      return !old ? [entry(actor, a, 'Created', changes)] : changes.length ? [entry(actor, a, 'Edited', changes)] : []
    })
    setAssets(commit(next, entries))
  }

  // Cancelled records are kept but left out of department lists and counts.
  const live = useMemo(() => assets.filter((a) => !isCancelled(a)), [assets])

  const byDepartment = useMemo(() => {
    const groups = new Map<string, Asset[]>()
    for (const a of live) {
      const key = matchDepartment(a.structureLocation) ?? UNASSIGNED
      groups.set(key, [...(groups.get(key) ?? []), a])
    }
    return groups
  }, [live])

  const myDepartment = user?.department ? matchDepartment(user.department) : undefined

  // Open on the user's own department only when it has assets in the uploaded data.
  const openOnMine = myDepartment && byDepartment.has(myDepartment)
  if (!slug) return <Navigate to={`/departments/${openOnMine ? departmentSlug(myDepartment) : ALL}`} replace />

  const inUse = departmentsInUse(live)
  const department = departmentFromSlug(slug, inUse)
  if (!department && slug !== ALL && slug !== UNASSIGNED) return <Navigate to="/departments" replace />

  // Only departments that appear in the uploaded assets are listed, largest first. A department
  // opened directly by URL is kept in the list so the selection is always visible.
  const unassignedCount = byDepartment.get(UNASSIGNED)?.length ?? 0
  const listed = [...new Set([...inUse, ...(department ? [department] : [])])]
    .map((d) => ({ key: departmentSlug(d), label: d, count: byDepartment.get(d)?.length ?? 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const entries = [
    { key: ALL, label: 'All assets', count: live.length },
    ...listed,
    ...(unassignedCount > 0 || slug === UNASSIGNED ? [{ key: UNASSIGNED, label: 'Unassigned', count: unassignedCount }] : []),
  ]

  const visible = slug === ALL ? live : (byDepartment.get(department ?? UNASSIGNED) ?? [])
  const cancelledHere = assets.filter((a) => isCancelled(a) && (slug === ALL || (matchDepartment(a.structureLocation) ?? UNASSIGNED) === (department ?? UNASSIGNED)))

  const onSave = (asset: Asset, originalId?: string) => {
    const idx = originalId ? assets.findIndex((a) => a.assetId === originalId) : -1
    // Edits are saved and logged; a new asset waits as Pending Approval until an approver approves it.
    if (idx >= 0) persist(assets.map((a, i) => (i === idx ? asset : a)))
    else setAssets(submitNewAsset(assets, asset, actor))
  }

  return (
    <>
      <PageHeader title="Departments & Locations" description="View and manage the assets assigned to each department." />
      <div className="dept-layout">
        <nav className="card dept-list" aria-label="Departments">
          {entries.map((e) => (
            <NavLink key={e.key} to={`/departments/${e.key}`} className={({ isActive }) => `dept-link${isActive ? ' is-active' : ''}${e.key === ALL ? ' is-all' : ''}`}>
              <span className="dept-link-label">
                {e.label}
                {myDepartment && e.label === myDepartment && <span className="dept-mine">You</span>}
              </span>
              <span className="dept-count">{e.count}</span>
            </NavLink>
          ))}
          {listed.length === 0 && <p className="dept-list-empty muted">Departments appear here after you upload a file.</p>}
        </nav>

        <select className="dept-select" value={slug} onChange={(e) => navigate(`/departments/${e.target.value}`)} aria-label="Department">
          {entries.map((e) => <option key={e.key} value={e.key}>{e.label} ({e.count})</option>)}
        </select>

        <DepartmentDetail
          key={slug}
          title={department ?? (slug === ALL ? 'All assets' : 'Unassigned')}
          department={department}
          isMine={!!department && department === myDepartment}
          showDepartment={slug === ALL}
          noAssetsAtAll={assets.length === 0}
          assets={visible}
          allAssets={assets}
          onSave={onSave}
          cancelledAssets={cancelledHere}
          actor={actor}
          onAssetsChange={setAssets}
        />
      </div>
    </>
  )
}

interface DetailProps {
  /** Nothing has been uploaded yet. */
  noAssetsAtAll: boolean
  title: string
  department?: string
  isMine: boolean
  showDepartment: boolean
  assets: Asset[]
  allAssets: Asset[]
  onSave: (asset: Asset, originalId?: string) => void
  /** Cancelled records in this view, shown only when the Cancelled status is chosen. */
  cancelledAssets: Asset[]
  actor: Actor
  /** Called after a status change, which saves and logs itself. */
  onAssetsChange: (next: Asset[]) => void
}

function DepartmentDetail({ noAssetsAtAll, title, department, isMine, showDepartment, assets, allAssets, onSave, cancelledAssets, actor, onAssetsChange }: DetailProps) {
  const [location, setLocation] = useState<string | null>(null)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [expiry, setExpiry] = useState('')
  const [editing, setEditing] = useState<Asset | 'new' | null>(null)
  const [statusFor, setStatusFor] = useState<Asset | null>(null)

  const locations = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of assets) counts.set(a.refinedLocation, (counts.get(a.refinedLocation) ?? 0) + 1)
    return [...counts.entries()].sort((x, y) => x[0].localeCompare(y[0]))
  }, [assets])

  const stats = useMemo(() => {
    let dueSoon = 0
    let overdue = 0
    for (const a of assets) {
      const { remainingLife } = replacement(a, currentYear)
      if (remainingLife == null) continue
      if (remainingLife < 0) overdue++
      else if (remainingLife <= DUE_SOON_YEARS) dueSoon++
    }
    return { dueSoon, overdue }
  }, [assets])

  const q = query.trim().toLowerCase()
  const rows = (status === 'Cancelled' ? cancelledAssets : assets)
    .filter((a) => location === null || a.refinedLocation === location)
    .filter((a) => !overdueOnly || (replacement(a, currentYear).remainingLife ?? 0) < 0)
    .filter((a) => !status || effectiveStatus(a) === status)
    .filter((a) => matchesExpiry(a, expiry))
    .filter((a) =>
      !q || [a.assetName, a.assetId, a.registerNumber, a.refinedLocation, a.roomArea, a.owner].some((v) => v?.toLowerCase().includes(q)),
    )

  return (
    <section className="dept-detail">
      <div className="dept-detail-header">
        <div>
          <h2>
            {title}
            {isMine && <span className="badge">Your department</span>}
          </h2>
          <p className="muted">
            {assets.length} asset{assets.length === 1 ? '' : 's'} across {locations.length} location{locations.length === 1 ? '' : 's'}
          </p>
        </div>
        <button className="button primary with-icon" onClick={() => setEditing('new')}>
          <Plus size={16} /> Add asset
        </button>
      </div>

      <div className="stat-grid">
        <div className="card stat"><span className="stat-label">Assets</span><span className="stat-value">{assets.length}</span></div>
        <div className="card stat"><span className="stat-label">Locations</span><span className="stat-value">{locations.length}</span></div>
        <div className="card stat"><span className="stat-label">Due within {DUE_SOON_YEARS} years</span><span className="stat-value">{stats.dueSoon}</span></div>
        <button
          type="button"
          className={`card stat stat-link${overdueOnly ? ' is-selected' : ''}`}
          onClick={() => setOverdueOnly((v) => !v)}
          aria-pressed={overdueOnly}
          disabled={stats.overdue === 0 && !overdueOnly}
          title={overdueOnly ? 'Show all assets' : 'Show only assets past their service life'}
        >
          <span className="stat-label">Past service life</span>
          <span className={`stat-value${stats.overdue ? ' text-error' : ''}`}>{stats.overdue}</span>
          {stats.overdue > 0 && <span className="stat-sub muted">{overdueOnly ? 'Showing overdue · click to show all' : 'Click to show overdue'}</span>}
        </button>
      </div>

      {noAssetsAtAll ? (
        <div className="card empty-state">
          <h2>No assets uploaded yet</h2>
          <p>Import your asset file to see departments and locations. Each asset's department comes from its Structure Location Name.</p>
          <div className="button-row">
            <Link className="button primary with-icon" to="/reports/import"><Upload size={16} /> Import CSV</Link>
          </div>
        </div>
      ) : assets.length === 0 ? (
        <div className="card empty-state">
          <h2>No assets assigned to {title} yet</h2>
          <p>Add one here, or import a CSV with this department in the Structure Location Name column.</p>
          <div className="button-row">
            <button className="button primary with-icon" onClick={() => setEditing('new')}><Plus size={16} /> Add asset</button>
            <Link className="button with-icon" to="/reports/import"><Upload size={16} /> Import CSV</Link>
          </div>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-toolbar">
            <div className="chips" role="group" aria-label="Filter by refined location">
              <button className={`chip${location === null ? ' is-selected' : ''}`} onClick={() => setLocation(null)}>
                All locations <span>{assets.length}</span>
              </button>
              {locations.map(([name, count]) => (
                <button key={name} className={`chip${location === name ? ' is-selected' : ''}`} onClick={() => setLocation(name)}>
                  {name || 'No location'} <span>{count}</span>
                </button>
              ))}
            </div>
            <select className="toolbar-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {ASSET_STATUSES.map((st) => <option key={st} value={st}>{st} ({(st === 'Cancelled' ? cancelledAssets : assets).filter((a) => effectiveStatus(a) === st).length})</option>)}
            </select>
            <ExpiryYearSelect assets={assets} value={expiry} onChange={setExpiry} className="toolbar-select" />
            <label className="search">
              <Search size={16} />
              <input placeholder="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>

          <div className="table-wrap flush">
            <table className="table">
              <thead>
                <tr>
                  <th className="actions-col">Actions</th>
                  <th>Asset</th>
                  <th>Status</th>
                  <th>Location</th>
                  {showDepartment && <th>Department</th>}
                  <th>Owner</th>
                  <th className="num">Quantity</th>
                  <th className="num">Installed</th>
                  <th className="num">Service life</th>
                  <th>Replacement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const { replacementYear, remainingLife } = replacement(a, currentYear)
                  return (
                    <tr key={a.assetId}>
                      <td className="actions-col">
                        <RowActions name={a.assetName} onEdit={() => setEditing(a)} onStatus={() => setStatusFor(a)} />
                      </td>
                      <td>
                        <div className="cell-strong"><FlagMark asset={a} />{a.assetName}</div>
                        <div className="muted">{[a.assetId, a.registerNumber].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="nowrap"><StatusPill asset={a} /></td>
                      <td>
                        <div>{a.refinedLocation || <span className="muted">—</span>}</div>
                        <div className="muted">{a.roomArea}</div>
                      </td>
                      {showDepartment && <td>{matchDepartment(a.structureLocation) ?? <span className="muted">Unassigned</span>}</td>}
                      <td>{a.owner || <span className="muted">—</span>}</td>
                      <td className="num">{a.quantity ?? '—'} {a.unitOfMeasure}</td>
                      <td className="num">{a.yearInstalled ?? '—'}</td>
                      <td className="num">
                        {a.serviceLifeYears != null ? `${a.serviceLifeYears} yrs` : '—'}
                        {a.serviceLifeAuto && <span className="auto-tag" title="Estimated from the asset name">auto</span>}
                      </td>
                      <td>
                        {replacementYear == null ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className="replacement">
                            {replacementYear}
                            {remainingLife! < 0 && <span className="pill danger">Overdue</span>}
                            {remainingLife! >= 0 && remainingLife! <= DUE_SOON_YEARS && (
                              <span className="pill warning">{remainingLife === 0 ? 'This year' : `In ${remainingLife} yr${remainingLife === 1 ? '' : 's'}`}</span>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={showDepartment ? 10 : 9} className="muted table-empty">No assets match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {statusFor && (
        <StatusModal asset={statusFor} assets={allAssets} actor={actor} onDone={onAssetsChange} onClose={() => setStatusFor(null)} />
      )}

      {editing && (
        <AssetFormModal
          asset={editing === 'new' ? undefined : editing}
          defaultDepartment={department}
          existingIds={new Set(allAssets.map((a) => a.assetId))}
          owners={[...new Set(allAssets.map((a) => a.owner.trim()).filter(Boolean))].sort()}
          knownAssets={allAssets}
          onSave={(asset, originalId) => {
            onSave(asset, originalId)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
