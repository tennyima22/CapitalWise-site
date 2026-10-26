import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, FileText, Info, Search } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import { loadAssets, type Asset } from '../../data/assets'
import { loadAudit } from '../../data/audit'
import { loadDeleted } from '../../data/deletedAssets'
import { matchDepartment } from '../../data/departments'
import { exportExcel, exportPdf, type Cell, type ExportColumn, type ExportTable } from '../../lib/exporters'
import { formatMoney, formatNumber } from '../../lib/format'

type Tab = 'disposed' | 'deleted'
type DeletionType = 'Cancelled record' | 'Rejected addition' | 'Permanently deleted'

interface DisposalRow {
  asset: Asset
  status: 'Disposed' | 'Pending Disposal'
}

interface DeletionRow {
  key: string
  asset: Asset
  type: DeletionType
  reason: string
  by: string
  at: string
}

const formatDate = (value?: string) => {
  if (!value) return ''
  // Disposal dates are plain YYYY-MM-DD; read them as local dates so they don't shift a day.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}
const department = (a: Asset) => matchDepartment(a.structureLocation) ?? '—'
const matches = (a: Asset, q: string, ...extra: string[]) =>
  !q || [a.assetId, a.assetName, a.registerNumber, a.structureLocation, ...extra].some((v) => v?.toLowerCase().includes(q))

const REJECTED_PREFIX = 'Addition rejected: '

function buildRows() {
  const assets = loadAssets()
  const audit = loadAudit() // newest first

  const disposals: DisposalRow[] = assets
    .filter((a) => a.status === 'Disposed' || a.status === 'Pending Disposal')
    .map((asset) => ({ asset, status: asset.status as DisposalRow['status'] }))
    .sort((x, y) => (y.asset.disposal?.date ?? '').localeCompare(x.asset.disposal?.date ?? ''))

  const cancelled: DeletionRow[] = assets
    .filter((a) => a.status === 'Cancelled')
    .map((asset) => {
      const rejected = asset.cancelReason?.startsWith(REJECTED_PREFIX) ?? false
      const logged = audit.find((e) => e.assetId === asset.assetId && (e.action === 'Cancelled' || e.action === 'Addition rejected'))
      return {
        key: `c-${asset.assetId}`,
        asset,
        type: rejected ? 'Rejected addition' : 'Cancelled record',
        reason: (rejected ? asset.cancelReason!.slice(REJECTED_PREFIX.length) : asset.cancelReason) ?? '',
        by: logged?.userName ?? '',
        at: logged?.at ?? '',
      }
    })

  const removed: DeletionRow[] = loadDeleted().map((d, i) => ({
    key: `d-${i}-${d.asset.assetId}`,
    asset: d.asset,
    type: 'Permanently deleted',
    reason: d.reason,
    by: d.deletedBy,
    at: d.deletedAt,
  }))

  const deletions = [...cancelled, ...removed].sort((x, y) => y.at.localeCompare(x.at))
  return { disposals, deletions }
}

const DISPOSAL_FILTERS = ['All', 'Disposed', 'Pending Disposal'] as const
const DELETION_FILTERS = ['All', 'Cancelled record', 'Rejected addition', 'Permanently deleted'] as const
const DELETION_FILTER_LABEL: Record<(typeof DELETION_FILTERS)[number], string> = {
  All: 'All',
  'Cancelled record': 'Cancelled',
  'Rejected addition': 'Rejected additions',
  'Permanently deleted': 'Permanently deleted',
}
const DELETION_CLASS: Record<DeletionType, string> = {
  'Cancelled record': 'status-disposed',
  'Rejected addition': 'status-flagged',
  'Permanently deleted': 'status-deleted',
}

export default function Disposals() {
  const [{ disposals, deletions }] = useState(buildRows)
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'deleted' ? 'deleted' : 'disposed'
  const setTab = (t: Tab) => setParams(t === 'deleted' ? { tab: t } : {}, { replace: true })
  const [query, setQuery] = useState('')
  const [disposalFilter, setDisposalFilter] = useState<(typeof DISPOSAL_FILTERS)[number]>('All')
  const [deletionFilter, setDeletionFilter] = useState<(typeof DELETION_FILTERS)[number]>('All')
  const [busy, setBusy] = useState(false)

  const q = query.trim().toLowerCase()
  const shownDisposals = disposals.filter((r) => (disposalFilter === 'All' || r.status === disposalFilter) && matches(r.asset, q, r.asset.disposal?.reason ?? ''))
  const shownDeletions = deletions.filter((r) => (deletionFilter === 'All' || r.type === deletionFilter) && matches(r.asset, q, r.reason, r.by))

  const stats = useMemo(() => {
    const disposed = disposals.filter((r) => r.status === 'Disposed')
    return {
      disposed: disposed.length,
      proceeds: disposed.reduce((s, r) => s + (r.asset.disposal?.price ?? 0), 0),
      pending: disposals.length - disposed.length,
      deleted: deletions.length,
    }
  }, [disposals, deletions])

  const table = (): ExportTable => {
    const generated = `Generated ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}`
    if (tab === 'disposed') {
      const columns: ExportColumn[] = [
        { header: 'Asset ID' }, { header: 'Asset Name' }, { header: 'Department' }, { header: 'Status' }, { header: 'Disposal Date' }, { header: 'Reason' },
        { header: 'Proceeds', kind: 'money' }, { header: 'Purchase Cost', kind: 'money' }, { header: 'Reference', pdf: false },
        { header: 'Requested By' }, { header: 'Approved By' }, { header: 'Approved On' },
      ]
      return {
        title: 'Disposed Assets',
        subtitle: [`${generated} · ${shownDisposals.length} asset${shownDisposals.length === 1 ? '' : 's'}`],
        columns,
        rows: shownDisposals.map(({ asset: a, status }): Cell[] => [
          a.assetId, a.assetName, department(a), status, formatDate(a.disposal?.date), a.disposal?.reason ?? '',
          a.disposal?.price ?? null, a.purchaseCost, a.disposal?.reference ?? '', a.disposal?.requestedBy ?? '', a.disposal?.approvedBy ?? '', formatDate(a.disposal?.approvedAt),
        ]),
      }
    }
    return {
      title: 'Cancelled & Deleted Assets',
      subtitle: [`${generated} · ${shownDeletions.length} record${shownDeletions.length === 1 ? '' : 's'}`],
      columns: [
        { header: 'Asset ID' }, { header: 'Asset Name' }, { header: 'Department' }, { header: 'Type' }, { header: 'Reason' },
        { header: 'By' }, { header: 'Date' }, { header: 'Purchase Cost', kind: 'money' },
      ],
      rows: shownDeletions.map((r): Cell[] => [r.asset.assetId, r.asset.assetName, department(r.asset), r.type, r.reason, r.by, formatDate(r.at), r.asset.purchaseCost]),
    }
  }

  const onExport = async (format: 'xlsx' | 'pdf') => {
    const name = `${tab === 'disposed' ? 'disposed-assets' : 'deleted-assets'}-${new Date().toISOString().slice(0, 10)}.${format}`
    setBusy(true)
    try {
      await (format === 'xlsx' ? exportExcel(table(), name) : exportPdf(table(), name))
    } finally {
      setBusy(false)
    }
  }

  const shownCount = tab === 'disposed' ? shownDisposals.length : shownDeletions.length

  return (
    <>
      <div className="page-header-row">
        <PageHeader title="Disposals & Deletions" description="Assets taken out of service, and records that were cancelled or deleted from the register." />
        <div className="button-row">
          <button className="button with-icon" onClick={() => onExport('xlsx')} disabled={busy || shownCount === 0}><FileSpreadsheet size={16} /> Excel</button>
          <button className="button with-icon" onClick={() => onExport('pdf')} disabled={busy || shownCount === 0}><FileText size={16} /> PDF</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="card stat">
          <span className="stat-label">Disposed assets</span>
          <span className="stat-value">{formatNumber(stats.disposed)}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Disposal proceeds</span>
          <span className="stat-value">{formatMoney(stats.proceeds)}</span>
          <span className="stat-sub muted">Sale, auction and trade-in amounts</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Awaiting disposal approval</span>
          <span className="stat-value">{formatNumber(stats.pending)}</span>
          {stats.pending > 0 && <Link className="stat-sub" to="/change-log">Review in Change Log & Approvals</Link>}
        </div>
        <div className="card stat">
          <span className="stat-label">Cancelled or deleted</span>
          <span className="stat-value">{formatNumber(stats.deleted)}</span>
        </div>
      </div>

      <div className="page-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'disposed'} className={tab === 'disposed' ? 'is-active' : ''} onClick={() => setTab('disposed')}>
          Disposed <span className="tab-count muted-count">{disposals.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'deleted'} className={tab === 'deleted' ? 'is-active' : ''} onClick={() => setTab('deleted')}>
          Cancelled & deleted <span className="tab-count muted-count">{deletions.length}</span>
        </button>
      </div>

      <section className="card table-card">
        <div className="table-toolbar">
          <div className="chips" role="group" aria-label="Filter">
            {tab === 'disposed'
              ? DISPOSAL_FILTERS.map((f) => (
                  <button key={f} className={`chip${disposalFilter === f ? ' is-selected' : ''}`} onClick={() => setDisposalFilter(f)}>
                    {f === 'Pending Disposal' ? 'Awaiting approval' : f} <span>{f === 'All' ? disposals.length : disposals.filter((r) => r.status === f).length}</span>
                  </button>
                ))
              : DELETION_FILTERS.map((f) => (
                  <button key={f} className={`chip${deletionFilter === f ? ' is-selected' : ''}`} onClick={() => setDeletionFilter(f)}>
                    {DELETION_FILTER_LABEL[f]} <span>{f === 'All' ? deletions.length : deletions.filter((r) => r.type === f).length}</span>
                  </button>
                ))}
          </div>
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search assets or reasons" aria-label="Search" />
          </label>
        </div>

        <div className="table-wrap flush">
          {tab === 'disposed' ? (
            <table className="table report-table">
              <thead>
                <tr>
                  <th>Asset</th><th>Department</th><th>Status</th><th>Disposal date</th><th>Reason</th>
                  <th className="num">Proceeds</th><th className="num">Purchase cost</th><th>Requested by</th><th>Approved by</th>
                </tr>
              </thead>
              <tbody>
                {shownDisposals.map(({ asset: a, status }) => (
                  <tr key={a.assetId}>
                    <td><div className="cell-strong">{a.assetName}</div><div className="muted">{a.assetId}{a.disposal?.reference ? ` · Ref ${a.disposal.reference}` : ''}</div></td>
                    <td>{department(a)}</td>
                    <td><span className={`status-pill ${status === 'Disposed' ? 'status-disposed' : 'status-pending'}`}>{status === 'Disposed' ? 'Disposed' : 'Awaiting approval'}</span></td>
                    <td className="nowrap">{formatDate(a.disposal?.date) || '—'}</td>
                    <td>{a.disposal?.reason || '—'}</td>
                    <td className="num">{a.disposal?.price != null ? formatMoney(a.disposal.price) : '—'}</td>
                    <td className="num">{a.purchaseCost != null ? formatMoney(a.purchaseCost) : '—'}</td>
                    <td>{a.disposal?.requestedBy ?? '—'}<div className="muted">{formatDate(a.disposal?.requestedAt)}</div></td>
                    <td>{a.disposal?.approvedBy ?? '—'}<div className="muted">{formatDate(a.disposal?.approvedAt)}</div></td>
                  </tr>
                ))}
                {shownDisposals.length === 0 && (
                  <tr><td colSpan={9} className="table-empty muted">{disposals.length ? 'No disposals match.' : 'No assets have been disposed of yet. Use Change status → Dispose on the Asset Register.'}</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="table report-table">
              <thead>
                <tr><th>Asset</th><th>Department</th><th>Type</th><th>Reason</th><th>By</th><th>Date</th><th className="num">Purchase cost</th></tr>
              </thead>
              <tbody>
                {shownDeletions.map((r) => (
                  <tr key={r.key}>
                    <td><div className="cell-strong">{r.asset.assetName}</div><div className="muted">{r.asset.assetId}</div></td>
                    <td>{department(r.asset)}</td>
                    <td><span className={`status-pill ${DELETION_CLASS[r.type]}`}>{r.type}</span></td>
                    <td>{r.reason || '—'}</td>
                    <td>{r.by || '—'}</td>
                    <td className="nowrap">{formatDate(r.at) || '—'}</td>
                    <td className="num">{r.asset.purchaseCost != null ? formatMoney(r.asset.purchaseCost) : '—'}</td>
                  </tr>
                ))}
                {shownDeletions.length === 0 && (
                  <tr><td colSpan={7} className="table-empty muted">{deletions.length ? 'No records match.' : 'No records have been cancelled or deleted.'}</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {tab === 'deleted' && (
          <p className="table-note muted report-note">
            <Info size={14} /> Cancelled records and rejected additions stay in the register, hidden, and can be restored from the Asset Register (Change status → Restore record). Permanently deleted assets are kept here as a copy from the moment they were removed.
          </p>
        )}
      </section>
    </>
  )
}
