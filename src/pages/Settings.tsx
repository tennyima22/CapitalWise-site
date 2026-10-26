import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Trash2, Upload } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { clearAssets, loadAssets } from '../data/assets'
import { formatNumber } from '../lib/format'
import { useAuth } from '../auth/authContext'
import { appendAudit, entry } from '../data/audit'
import { isAdministrator } from '../data/lifecycle'
import { archiveDeleted } from '../data/deletedAssets'

export default function Settings() {
  const { user } = useAuth()
  const admin = isAdministrator(user?.role ?? '')
  const [count, setCount] = useState(() => loadAssets().length)
  const [cleared, setCleared] = useState(false)

  const onDeleteAll = () => {
    if (!window.confirm(`Delete all ${formatNumber(count)} assets from the register? This cannot be undone. Your sign-in and plan settings (inflation, reserve balance, contributions) are kept.`)) return
    const actor = { name: user?.name ?? 'Unknown', email: user?.email ?? '', role: user?.role ?? '' }
    archiveDeleted(loadAssets(), actor, 'Delete all assets (Settings)')
    clearAssets()
    appendAudit([entry(actor, { assetId: '—', assetName: 'Whole register' }, 'Register cleared', [], `Deleted ${count} assets from Settings`)])
    setCount(0)
    setCleared(true)
  }

  return (
    <>
      <PageHeader title="Settings" description="Manage the data stored for this register." />

      <section className="card settings-card">
        <div>
          <h2>Asset data</h2>
          <p className="muted">
            {count > 0
              ? `${formatNumber(count)} asset${count === 1 ? ' is' : 's are'} saved in this browser.`
              : 'No assets are saved in this browser.'}
          </p>
        </div>

        {cleared && (
          <p className="forecast-ok">
            <CheckCircle2 size={16} />
            <span>All assets were deleted. <Link to="/reports/import">Import a file</Link> to start again.</span>
          </p>
        )}

        <div className="danger-zone">
          <div>
            <strong>Delete all assets</strong>
            <p className="muted">
              Removes every asset, cost, register number and estimate. Inflation and cash forecast settings and the activity log are kept, and a copy of each asset is listed under Reports → Disposals & Deletions.
              {!admin && <> Only an Admin can do this; to remove a single record entered in error, use <strong>Change status → Cancel record</strong>.</>}
            </p>
          </div>
          <div className="button-row">
            {count === 0 && (
              <Link className="button with-icon" to="/reports/import"><Upload size={16} /> Import CSV</Link>
            )}
            <button className="button danger with-icon" onClick={onDeleteAll} disabled={count === 0 || !admin}>
              <Trash2 size={16} /> Delete all assets
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
