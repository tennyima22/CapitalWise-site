import { useMemo, useState } from 'react'
import { CheckCircle2, Lock, Search, XCircle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StatusModal from './assets/StatusModal'
import { useAuth } from '../auth/authContext'
import { loadAssets, type Asset } from '../data/assets'
import { loadAudit, type Actor, type AuditAction } from '../data/audit'
import { additionBlock, approvalBlock, canApprove } from '../data/lifecycle'
import { matchDepartment } from '../data/departments'
import { formatMoney, formatNumber } from '../lib/format'

const PAGE = 200

export default function ChangeLog() {
  const { user } = useAuth()
  const actor: Actor = { name: user?.name ?? 'Unknown', email: user?.email ?? '', role: user?.role ?? 'Staff' }
  const [assets, setAssets] = useState(loadAssets)
  const [log, setLog] = useState(loadAudit)
  const [tab, setTab] = useState<'approvals' | 'log'>(() => (loadAssets().some((a) => a.status === 'Pending Disposal' || a.status === 'Pending Approval') ? 'approvals' : 'log'))
  const [deciding, setDeciding] = useState<{ asset: Asset; step: 'approve' | 'reject' | 'approveAdd' | 'rejectAdd' } | null>(null)
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const pending = assets.filter((a) => a.status === 'Pending Disposal')
  const newAssets = assets.filter((a) => a.status === 'Pending Approval')
  const waiting = pending.length + newAssets.length
  const actions = useMemo(() => [...new Set(log.map((e) => e.action))].sort() as AuditAction[], [log])

  const q = query.trim().toLowerCase()
  const filteredLog = log.filter(
    (e) =>
      (!action || e.action === action) &&
      (!q || [e.assetId, e.assetName, e.userName, e.userEmail, e.note ?? '', ...e.changes.flatMap((c) => [c.field, c.from, c.to])].some((v) => v.toLowerCase().includes(q))),
  )

  const onDecided = (next: Asset[]) => {
    setAssets(next)
    setLog(loadAudit())
  }

  return (
    <>
      <PageHeader title="Change Log & Approvals" description="Approve disposals and review the permanent record of every change." />

      <div className="page-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'approvals'} className={tab === 'approvals' ? 'is-active' : ''} onClick={() => setTab('approvals')}>
          Approvals {waiting > 0 && <span className="tab-count">{waiting}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'is-active' : ''} onClick={() => setTab('log')}>
          Activity log <span className="tab-count muted-count">{formatNumber(log.length)}</span>
        </button>
      </div>

      {tab === 'approvals' && (
        <section className="card table-card approvals-section">
          <div className="upcoming-header">
            <div>
              <h2>New assets awaiting approval</h2>
              <p className="muted">New assets stay out of costs and forecasts until approved. You can’t approve an asset you added yourself.</p>
            </div>
          </div>
          {newAssets.length === 0 ? (
            <p className="muted table-empty">No new assets are waiting for approval.</p>
          ) : (
            <div className="table-wrap flush">
              <table className="table approvals-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Department</th>
                    <th>Location</th>
                    <th className="num">Quantity</th>
                    <th className="num">Purchase cost</th>
                    <th>Added by</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {newAssets.map((a) => {
                    const block = additionBlock(a, actor)
                    return (
                      <tr key={a.assetId}>
                        <td>
                          <div className="cell-strong">{a.assetName}</div>
                          <div className="muted">{a.assetId}{a.replacesAssetId && ` · replaces ${a.replacesAssetId}`}</div>
                        </td>
                        <td>{matchDepartment(a.structureLocation) ?? '—'}</td>
                        <td>{[a.refinedLocation, a.roomArea].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                        <td className="num nowrap">{a.quantity ?? '—'} {a.unitOfMeasure}</td>
                        <td className="num">{a.purchaseCost == null ? <span className="muted">—</span> : formatMoney(a.purchaseCost)}</td>
                        <td>
                          <div>{a.addition?.requestedBy}</div>
                          <div className="muted">{a.addition?.requestedAt && new Date(a.addition.requestedAt).toLocaleString()}</div>
                        </td>
                        <td className="nowrap">
                          <div className="button-row decision-buttons">
                            <button className="button primary with-icon" disabled={!!block} title={block ?? 'Approve new asset'} onClick={() => setDeciding({ asset: a, step: 'approveAdd' })}>
                              <CheckCircle2 size={15} /> Approve
                            </button>
                            <button className="button with-icon" disabled={!canApprove(actor.role)} title={canApprove(actor.role) ? 'Reject new asset' : 'Only an approver can reject'} onClick={() => setDeciding({ asset: a, step: 'rejectAdd' })}>
                              <XCircle size={15} /> Reject
                            </button>
                          </div>
                          {block && <div className="muted decision-note">{block}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'approvals' && (
        <section className="card table-card">
          <div className="upcoming-header">
            <div>
              <h2>Pending disposals</h2>
              <p className="muted">
                {canApprove(actor.role)
                  ? 'Approve to mark an asset Disposed, or reject to return it to service. You can’t approve a request you made yourself.'
                  : `You’re signed in as ${actor.role}: you can request disposals, but an Asset Manager, Finance Controller or Admin must approve them.`}
              </p>
            </div>
          </div>
          {pending.length === 0 ? (
            <p className="muted table-empty">No disposals are waiting for approval.</p>
          ) : (
            <div className="table-wrap flush">
              <table className="table approvals-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Department</th>
                    <th>Reason</th>
                    <th>Disposal date</th>
                    <th className="num">Disposal price</th>
                    <th>Reference</th>
                    <th>Requested by</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((a) => {
                    const block = approvalBlock(a, actor)
                    return (
                      <tr key={a.assetId}>
                        <td>
                          <div className="cell-strong">{a.assetName}</div>
                          <div className="muted">{a.assetId}{a.replacedByAssetId && ` · replaced by ${a.replacedByAssetId}`}</div>
                        </td>
                        <td>{matchDepartment(a.structureLocation) ?? '—'}</td>
                        <td>{a.disposal?.reason}</td>
                        <td className="nowrap">{a.disposal?.date}</td>
                        <td className="num">{a.disposal?.price == null ? <span className="muted">—</span> : formatMoney(a.disposal.price)}</td>
                        <td>{a.disposal?.reference || <span className="muted">—</span>}</td>
                        <td>
                          <div>{a.disposal?.requestedBy}</div>
                          <div className="muted">{a.disposal?.requestedAt && new Date(a.disposal.requestedAt).toLocaleString()}</div>
                        </td>
                        <td className="nowrap">
                          <div className="button-row decision-buttons">
                            <button className="button primary with-icon" disabled={!!block} title={block ?? 'Approve disposal'} onClick={() => setDeciding({ asset: a, step: 'approve' })}>
                              <CheckCircle2 size={15} /> Approve
                            </button>
                            <button className="button with-icon" disabled={!canApprove(actor.role)} title={canApprove(actor.role) ? 'Reject request' : 'Only an approver can reject'} onClick={() => setDeciding({ asset: a, step: 'reject' })}>
                              <XCircle size={15} /> Reject
                            </button>
                          </div>
                          {block && <div className="muted decision-note">{block}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'log' && (
        <section className="card table-card">
          <div className="table-toolbar">
            <div className="filters">
              <select value={action} onChange={(e) => { setAction(e.target.value); setLimit(PAGE) }} aria-label="Action">
                <option value="">All actions</option>
                {actions.map((a) => <option key={a} value={a}>{a} ({log.filter((e) => e.action === a).length})</option>)}
              </select>
            </div>
            <label className="search">
              <Search size={16} />
              <input placeholder="Search asset, user or value" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }} />
            </label>
          </div>
          <p className="log-note muted"><Lock size={13} /> The activity log is permanent: entries are added automatically and can’t be edited or deleted.</p>
          {filteredLog.length === 0 ? (
            <p className="muted table-empty">{log.length === 0 ? 'Nothing has been recorded yet. Changes made from now on appear here.' : 'No entries match.'}</p>
          ) : (
            <div className="table-wrap flush">
              <table className="table log-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Asset</th>
                    <th>What changed</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLog.slice(0, limit).map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{new Date(e.at).toLocaleString()}</td>
                      <td>
                        <div>{e.userName}</div>
                        <div className="muted">{e.userRole}</div>
                      </td>
                      <td className="nowrap"><span className={`log-action log-${e.action.split(' ')[0].toLowerCase()}`}>{e.action}</span></td>
                      <td>
                        <div className="cell-strong">{e.assetName}</div>
                        <div className="muted">{e.assetId}</div>
                      </td>
                      <td className="log-changes">
                        {e.changes.slice(0, 4).map((c, i) => (
                          <div key={i}><span className="history-field">{c.field}</span> <span className="history-from">{c.from}</span> → <span className="history-to">{c.to}</span></div>
                        ))}
                        {e.changes.length > 4 && <div className="muted">+{e.changes.length - 4} more</div>}
                        {e.note && <div className="history-note">{e.note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filteredLog.length > limit && (
            <p className="table-note muted">
              Showing {formatNumber(limit)} of {formatNumber(filteredLog.length)}.{' '}
              <button className="link-button" onClick={() => setLimit((l) => l + PAGE)}>Show more</button>
            </p>
          )}
        </section>
      )}

      {deciding && (
        <StatusModal asset={deciding.asset} assets={assets} actor={actor} initialStep={deciding.step} onDone={onDecided} onClose={() => setDeciding(null)} />
      )}
    </>
  )
}
