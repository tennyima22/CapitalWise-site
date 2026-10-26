import { useMemo, useRef, useState } from 'react'
import ScrollRail from '../../components/ScrollRail'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Hash, Plus, Search, Sparkles, Upload, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import AssetFormModal from '../departments/AssetFormModal'
import StatusPill, { FlagMark } from '../../components/StatusPill'
import RowActions from '../../components/RowActions'
import ExpiryYearSelect from '../../components/ExpiryYearSelect'
import ColumnFilter, { type FilterOption } from '../../components/ColumnFilter'
import { effectiveStatus, expiryYear, inCapitalPlan, isCancelled, matchesExpiry, ASSET_STATUSES, PLAN_YEARS, costSource, estimatedReplacementCost, loadAssets, replacement, replacementPlan, type Asset } from '../../data/assets'
import { loadSettings, saveSettings } from '../../data/settings'
import { buildLifeIndex } from '../../data/usefulLife'
import { createRegisterNumberer } from '../../data/registerNumber'
import { departmentsInUse, matchDepartment } from '../../data/departments'
import { formatMoney, formatNumber } from '../../lib/format'
import { useAuth } from '../../auth/authContext'
import { diffAssets, entry, type Actor } from '../../data/audit'
import { commit, submitNewAsset } from '../../data/lifecycle'
import StatusModal from './StatusModal'

const NEAR_TERM_YEARS = 5
const FIRST_YEAR = PLAN_YEARS[0]
const LAST_YEAR = PLAN_YEARS[PLAN_YEARS.length - 1]

/** Alternate shading in 5-year blocks (2026–29, 2030–34, 2035–39, …) like the planning spreadsheet. */
const yearBand = (year: number) => `year-band-${Math.floor(year / 5) % 2}`

/** Expiry Year cell: red once the year has passed (unless the asset is disposed). */
function ExpiryCell({ asset }: { asset: Asset }) {
  const year = expiryYear(asset)
  const expired = year != null && year < PLAN_START && inCapitalPlan(asset)
  return (
    <td className={`num${expired ? ' expired' : ''}`} title={year != null ? `${asset.yearInstalled} + ${asset.serviceLifeYears} years${expired ? ' (expired)' : ''}` : 'Needs Year Installed and Asset Service Life'}>
      {year ?? ''}
    </td>
  )
}

const PLAN_START = PLAN_YEARS[0]

type RegisterRow = { asset: Asset; plan: ReturnType<typeof replacementPlan>; estimate: ReturnType<typeof estimatedReplacementCost> }
type CellValue = { key: string; label: string; sort: string | number }

const textValue = (v: string | null | undefined): CellValue => {
  const t = (v ?? '').trim()
  return { key: t, label: t, sort: t.toLowerCase() }
}
const numberValue = (n: number | null | undefined, format: (n: number) => string = String): CellValue =>
  n == null ? { key: '', label: '', sort: 0 } : { key: String(Math.round(n * 100) / 100), label: format(n), sort: n }

/** What each filterable column shows, used to build its filter list and to match rows. */
const COLUMN_VALUES: Record<string, (r: RegisterRow) => CellValue> = {
  structure: (r) => textValue(matchDepartment(r.asset.structureLocation) ?? r.asset.structureLocation),
  refined: (r) => textValue(r.asset.refinedLocation),
  project: (r) => textValue(r.asset.majorProject),
  room: (r) => textValue(r.asset.roomArea),
  owner: (r) => textValue(r.asset.owner),
  assetId: (r) => textValue(r.asset.assetId),
  register: (r) => textValue(r.asset.registerNumber),
  assetName: (r) => textValue(r.asset.assetName),
  status: (r) => textValue(effectiveStatus(r.asset)),
  qty: (r) => numberValue(r.asset.quantity, (n) => formatNumber(n)),
  uom: (r) => textValue(r.asset.unitOfMeasure),
  ledger: (r) => textValue(r.asset.ledgerId),
  installed: (r) => numberValue(r.asset.yearInstalled),
  life: (r) => numberValue(r.asset.serviceLifeYears, (n) => `${n} yrs`),
  expiry: (r) => numberValue(expiryYear(r.asset)),
  purchase: (r) => numberValue(r.asset.purchaseCost, (n) => formatMoney(n)),
  invoice: (r) => textValue(r.asset.invoiceNumber),
  unitCost: (r) => numberValue(r.asset.unitReplacementCost, (n) => formatMoney(n)),
  aggregate: (r) => numberValue(r.plan.aggregate, (n) => formatMoney(n)),
  estimate: (r) => numberValue(r.estimate?.amount, (n) => formatMoney(n)),
}

export default function AssetRegister() {
  const [assets, setAssets] = useState(loadAssets)
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('')
  const [refined, setRefined] = useState('')
  const [expiry, setExpiry] = useState('')
  const [status, setStatus] = useState('')
  // ?replacement=overdue or ?replacement=soon (e.g. from the Dashboard's "Past service life" tile).
  const [searchParams, setSearchParams] = useSearchParams()
  const due = searchParams.get('replacement') === 'overdue' || searchParams.get('replacement') === 'soon' ? searchParams.get('replacement')! : ''
  const setDue = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('replacement', value)
    else next.delete('replacement')
    setSearchParams(next, { replace: true })
  }
  const [editing, setEditing] = useState<Asset | 'new' | null>(null)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const [inflationInput, setInflationInput] = useState(() => String(loadSettings().inflationRate))

  const parsedInflation = Number(inflationInput)
  const inflationValid = inflationInput.trim() !== '' && Number.isFinite(parsedInflation) && parsedInflation >= 0 && parsedInflation <= 25
  const inflationRate = inflationValid ? parsedInflation : 0

  const onInflationChange = (value: string) => {
    setInflationInput(value)
    const n = Number(value)
    if (value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 25) saveSettings({ ...loadSettings(), inflationRate: n })
  }

  const { user } = useAuth()
  const actor: Actor = { name: user?.name ?? 'Unknown', email: user?.email ?? '', role: user?.role ?? 'Staff' }
  const [statusFor, setStatusFor] = useState<Asset | null>(null)

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

  // Assets with no useful life that can be estimated from their name.
  const lifeEstimates = useMemo(() => {
    const index = buildLifeIndex(assets)
    return assets
      .filter((a) => a.serviceLifeYears == null)
      .map((a) => ({ asset: a, suggestion: index.suggest(a.assetName) }))
      .filter((x) => x.suggestion != null)
  }, [assets])

  // Assets that need a register number and have the department and year to generate one.
  const unnumbered = useMemo(() => {
    const numberer = createRegisterNumberer(assets)
    return assets.filter((a) => !a.registerNumber.trim() && numberer.peek(a) != null)
  }, [assets])

  const assignRegisterNumbers = () => {
    const n = unnumbered.length
    if (!window.confirm(`Assign register numbers to ${n} asset${n === 1 ? '' : 's'}? Numbers continue from the highest already used for each department and year.`)) return
    const numberer = createRegisterNumberer(assets)
    persist(assets.map((a) => (a.registerNumber.trim() ? a : { ...a, registerNumber: numberer.next(a) ?? '' })))
  }

  const fillMissingLives = () => {
    const n = lifeEstimates.length
    if (!window.confirm(`Estimate the useful life of ${n} asset${n === 1 ? '' : 's'} from the asset name? They'll be marked "auto" so you can review them.`)) return
    const byId = new Map(lifeEstimates.map((x) => [x.asset.assetId, x.suggestion!.years]))
    persist(assets.map((a) => (a.serviceLifeYears == null && byId.has(a.assetId) ? { ...a, serviceLifeYears: byId.get(a.assetId)!, serviceLifeAuto: true } : a)))
  }

  // Departments that appear in the uploaded assets, in the standard order.
  const presentDepartments = useMemo(() => departmentsInUse(assets), [assets])
  const refinedLocations = useMemo(() => [...new Set(assets.map((a) => a.refinedLocation.trim()).filter(Boolean))].sort(), [assets])
  const owners = useMemo(() => [...new Set(assets.map((a) => a.owner.trim()).filter(Boolean))].sort(), [assets])

  const q = query.trim().toLowerCase()
  const baseRows = useMemo(
    () =>
      assets
        .filter((a) => !department || (department === 'unassigned' ? !matchDepartment(a.structureLocation) : matchDepartment(a.structureLocation) === department))
        .filter((a) => !refined || a.refinedLocation.trim() === refined)
        .filter((a) => matchesExpiry(a, expiry))
        // Cancelled records are hidden unless you choose the Cancelled status.
        .filter((a) => (status === 'Cancelled' ? isCancelled(a) : !isCancelled(a)))
        .filter((a) => !status || effectiveStatus(a) === status)
        .filter((a) => {
          if (!due) return true
          const { remainingLife } = replacement(a)
          return remainingLife != null && (due === 'overdue' ? remainingLife < 0 : remainingLife >= 0 && remainingLife < NEAR_TERM_YEARS)
        })
        .filter((a) =>
          !q ||
          [a.assetName, a.assetId, a.registerNumber, a.ledgerId, a.majorProject, a.invoiceNumber, a.refinedLocation, a.roomArea, a.owner].some((v) => v?.toLowerCase().includes(q)),
        )
        .map((a) => ({ asset: a, plan: replacementPlan(a, PLAN_YEARS, inflationRate), estimate: estimatedReplacementCost(a, inflationRate) })),
    [assets, department, refined, expiry, status, due, q, inflationRate],
  )

  // Excel-style filters on each column header: column id -> the values to keep.
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({})
  const setColumnFilter = (id: string, keep: Set<string> | undefined) =>
    setColumnFilters((f) => {
      const next = { ...f }
      if (keep) next[id] = keep
      else delete next[id]
      return next
    })
  const passes = (row: RegisterRow, except?: string) =>
    Object.entries(columnFilters).every(([id, keep]) => id === except || keep.has(COLUMN_VALUES[id](row).key))
  const rows = useMemo(() => baseRows.filter((r) => passes(r)), [baseRows, columnFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The values in a column (with counts), given every other active filter. */
  const optionsFor = (id: string): FilterOption[] => {
    const counts = new Map<string, { label: string; count: number; sort: string | number }>()
    for (const r of baseRows) {
      if (!passes(r, id)) continue
      const v = COLUMN_VALUES[id](r)
      const entry = counts.get(v.key) ?? { label: v.label, count: 0, sort: v.sort }
      entry.count++
      counts.set(v.key, entry)
    }
    return [...counts.entries()]
      .sort(([ka, a], [kb, b]) => (ka === '' ? 1 : kb === '' ? -1 : typeof a.sort === 'number' && typeof b.sort === 'number' ? a.sort - b.sort : String(a.sort).localeCompare(String(b.sort))))
      .map(([key, v]) => ({ key, label: key === '' ? '(Blanks)' : v.label, count: v.count }))
  }

  const filterButton = (id: string, label: string) => (
    <ColumnFilter label={label} getOptions={() => optionsFor(id)} selected={columnFilters[id]} onChange={(keep) => setColumnFilter(id, keep)} />
  )
  const activeColumnFilters = Object.keys(columnFilters).length

  const totals = useMemo(() => {
    const byYear = new Map<number, number>(PLAN_YEARS.map((y) => [y, 0]))
    let aggregate = 0
    let estimate = 0
    for (const { plan, estimate: est } of rows) {
      aggregate += plan.aggregate ?? 0
      estimate += est?.amount ?? 0
      for (const [y, amount] of plan.byYear) byYear.set(y, (byYear.get(y) ?? 0) + amount)
    }
    const nearTerm = PLAN_YEARS.slice(0, NEAR_TERM_YEARS).reduce((sum, y) => sum + (byYear.get(y) ?? 0), 0)
    const planTotal = PLAN_YEARS.reduce((sum, y) => sum + (byYear.get(y) ?? 0), 0)
    return { byYear, aggregate, estimate, nearTerm, planTotal }
  }, [rows])

  const onSave = (asset: Asset, originalId?: string) => {
    const idx = originalId ? assets.findIndex((a) => a.assetId === originalId) : -1
    // Edits are saved and logged; a new asset waits as Pending Approval until an approver approves it.
    if (idx >= 0) persist(assets.map((a, i) => (i === idx ? asset : a)))
    else setAssets(submitNewAsset(assets, asset, actor))
    setEditing(null)
  }


  const filtered = rows.length !== assets.length

  return (
    <>
      <div className="page-header-row">
        <PageHeader
          title="Asset Register"
          description={`Every asset with its location, owner, replacement cost and ${FIRST_YEAR}–${LAST_YEAR} replacement schedule.`}
        />
        <div className="button-row">
          <Link className="button with-icon" to="/reports/import"><Upload size={16} /> Import</Link>
          <Link className="button with-icon" to="/reports/export"><Download size={16} /> Export</Link>
          <button className="button primary with-icon" onClick={() => setEditing('new')}><Plus size={16} /> Add asset</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="card stat"><span className="stat-label">Assets{filtered ? ' (filtered)' : ''}</span><span className="stat-value">{rows.length}</span></div>
        <div className="card stat">
          <span className="stat-label">Replacement cost <span className="estimate-tag" title="Estimate: today's aggregate cost with yearly inflation to each asset's replacement year">Estimate</span></span>
          <span className="stat-value">{formatMoney(totals.estimate)}</span>
          <span className="stat-sub muted">With {inflationRate}% inflation · {formatMoney(totals.aggregate)} today</span>
        </div>
        <div className="card stat"><span className="stat-label">Due {FIRST_YEAR}–{FIRST_YEAR + NEAR_TERM_YEARS - 1} (with inflation)</span><span className="stat-value">{formatMoney(totals.nearTerm)}</span></div>
        <div className="card stat"><span className="stat-label">Total {FIRST_YEAR}–{LAST_YEAR} (with inflation)</span><span className="stat-value">{formatMoney(totals.planTotal)}</span></div>
      </div>

      <div className="card plan-bar">
        <label className="inflation-field">
          <span>Inflation</span>
          <span className={`input-suffix${inflationValid ? '' : ' has-error'}`}>
            <input value={inflationInput} onChange={(e) => onInflationChange(e.target.value)} inputMode="decimal" aria-label="Inflation percent per year" />
            <span>% / yr</span>
          </span>
        </label>
        <p className="muted">
          {inflationValid
            ? <>Year columns show the cost in that year: today's aggregate × (1 + {inflationRate}%) for each year after {FIRST_YEAR}.</>
            : <span className="text-error">Enter a percentage between 0 and 25. No inflation is applied until then.</span>}
        </p>
        {unnumbered.length > 0 && (
          <button className="button with-icon" onClick={assignRegisterNumbers}>
            <Hash size={16} /> Assign {unnumbered.length} register number{unnumbered.length === 1 ? '' : 's'}
          </button>
        )}
        {lifeEstimates.length > 0 && (
          <button className="button with-icon" onClick={fillMissingLives}>
            <Sparkles size={16} /> Estimate {lifeEstimates.length} missing useful li{lifeEstimates.length === 1 ? 'fe' : 'ves'}
          </button>
        )}
      </div>

      {assets.length === 0 ? (
        <div className="card empty-state">
          <h2>No assets yet</h2>
          <p>Add assets one at a time, or import them from a CSV file.</p>
          <div className="button-row">
            <button className="button primary with-icon" onClick={() => setEditing('new')}><Plus size={16} /> Add asset</button>
            <Link className="button with-icon" to="/reports/import"><Upload size={16} /> Import CSV</Link>
          </div>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-toolbar">
            <div className="filters">
              <select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
                <option value="">All departments</option>
                {presentDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
                <option value="unassigned">Unassigned</option>
              </select>
              <select value={due} onChange={(e) => setDue(e.target.value)} aria-label="Replacement" className={due ? 'is-active-filter' : undefined}>
                <option value="">All replacement years</option>
                <option value="overdue">Past service life</option>
                <option value="soon">Due {FIRST_YEAR}–{FIRST_YEAR + NEAR_TERM_YEARS - 1}</option>
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                <option value="">All statuses</option>
                {ASSET_STATUSES.map((s) => <option key={s} value={s}>{s} ({assets.filter((a) => effectiveStatus(a) === s).length})</option>)}
              </select>
              <select value={refined} onChange={(e) => setRefined(e.target.value)} aria-label="Refined location">
                <option value="">All refined locations</option>
                {refinedLocations.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ExpiryYearSelect assets={assets} value={expiry} onChange={setExpiry} className={expiry ? 'is-active-filter' : undefined} />
            </div>
            <div className="toolbar-right">
              {activeColumnFilters > 0 && (
                <button className="button with-icon clear-col-filters" onClick={() => setColumnFilters({})}>
                  <X size={15} /> Clear column filters ({activeColumnFilters})
                </button>
              )}
              <label className="search">
                <Search size={16} />
                <input placeholder="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
          </div>

          <ScrollRail
            target={tableWrapRef}
            jumps={[
              { label: 'Asset details', selector: '[data-col="details"]' },
              { label: 'Costs', selector: '[data-col="costs"]' },
              { label: `${FIRST_YEAR}–${LAST_YEAR} schedule`, selector: '[data-col="schedule"]' },
            ]}
          />
          <div className="table-wrap flush register-wrap" ref={tableWrapRef}>
            <table className="table register-table">
              <thead>
                <tr>
                  <th className="actions-col">Actions</th>
                  <th data-col="details"><span className="th-inner">Structure Location{filterButton('structure', 'Structure Location')}</span></th>
                  <th><span className="th-inner">Refined Location{filterButton('refined', 'Refined Location')}</span></th>
                  <th><span className="th-inner">Project Number{filterButton('project', 'Project Number')}</span></th>
                  <th><span className="th-inner">Room/Area Name{filterButton('room', 'Room/Area Name')}</span></th>
                  <th><span className="th-inner">Owner{filterButton('owner', 'Owner')}</span></th>
                  <th><span className="th-inner">Asset ID{filterButton('assetId', 'Asset ID')}</span></th>
                  <th><span className="th-inner">Register Number{filterButton('register', 'Register Number')}</span></th>
                  <th><span className="th-inner">Asset Name{filterButton('assetName', 'Asset Name')}</span></th>
                  <th><span className="th-inner">Status{filterButton('status', 'Status')}</span></th>
                  <th className="num"><span className="th-inner">Qty{filterButton('qty', 'Qty')}</span></th>
                  <th><span className="th-inner">Unit of Measure{filterButton('uom', 'Unit of Measure')}</span></th>
                  <th><span className="th-inner">Ledger Number{filterButton('ledger', 'Ledger Number')}</span></th>
                  <th className="num"><span className="th-inner">Year Installed{filterButton('installed', 'Year Installed')}</span></th>
                  <th className="num"><span className="th-inner">Asset Service Life{filterButton('life', 'Asset Service Life')}</span></th>
                  <th className="num" title="Year Installed + Asset Service Life"><span className="th-inner">Expiry Year{filterButton('expiry', 'Expiry Year')}</span></th>
                  <th className="num" data-col="costs"><span className="th-inner">Purchase Cost{filterButton('purchase', 'Purchase Cost')}</span></th>
                  <th><span className="th-inner">Invoice Number{filterButton('invoice', 'Invoice Number')}</span></th>
                  <th className="num"><span className="th-inner">Unit Replacement{filterButton('unitCost', 'Unit Replacement')}</span></th>
                  <th className="num"><span className="th-inner">Aggregate (today){filterButton('aggregate', 'Aggregate (today)')}</span></th>
                  <th className="num estimate-col" title="Estimate: aggregate with yearly inflation to the replacement year"><span className="th-inner">Est. Replacement Cost <span className="estimate-tag">Estimate</span>{filterButton('estimate', 'Est. Replacement Cost')}</span></th>
                  {PLAN_YEARS.map((y, i) => <th key={y} className={`num year ${yearBand(y)}`} data-col={i === 0 ? 'schedule' : undefined}>{y}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ asset: a, plan, estimate }) => (
                  <tr key={a.assetId}>
                    <td className="actions-col">
                      <RowActions name={a.assetName} onEdit={() => setEditing(a)} onStatus={() => setStatusFor(a)} />
                    </td>
                    <td>{matchDepartment(a.structureLocation) ?? (a.structureLocation || <span className="muted">Unassigned</span>)}</td>
                    <td>{a.refinedLocation}</td>
                    <td>{a.majorProject}</td>
                    <td>{a.roomArea}</td>
                    <td>{a.owner}</td>
                    <td className="nowrap">{a.assetId}</td>
                    <td className="nowrap">{a.registerNumber}</td>
                    <td className="cell-strong"><FlagMark asset={a} />{a.assetName}</td>
                    <td className="nowrap"><StatusPill asset={a} /></td>
                    <td className="num">{formatNumber(a.quantity)}</td>
                    <td>{a.unitOfMeasure}</td>
                    <td className="nowrap">{a.ledgerId}</td>
                    <td className="num">{a.yearInstalled ?? ''}</td>
                    <td className="num">
                      {a.serviceLifeYears ?? ''}
                      {a.serviceLifeAuto && <span className="auto-tag" title="Estimated from the asset name. Edit the asset to confirm or change it.">auto</span>}
                    </td>
                    <ExpiryCell asset={a} />
                    <td className="num">{formatMoney(a.purchaseCost)}</td>
                    <td className="nowrap">{a.invoiceNumber}</td>
                    <td className="num">{formatMoney(a.unitReplacementCost)}</td>
                    <td className="num" title={costSource(a) === 'purchase' ? `Purchase cost ${formatMoney(a.purchaseCost)} from ${a.yearInstalled ?? 'an unknown year'}, inflated to ${FIRST_YEAR} at ${inflationRate}% a year` : undefined}>
                      {formatMoney(plan.aggregate)}
                      {costSource(a) === 'purchase' && <div className="muted">from purchase</div>}
                    </td>
                    <td className="num estimate-col" title={estimate?.year ? `Estimated for ${estimate.year} at ${inflationRate}% yearly inflation` : estimate ? "No replacement year: today's cost" : undefined}>
                      <span className="cell-strong">{formatMoney(estimate?.amount)}</span>
                      {estimate?.year != null && <div className="muted">in {estimate.year}</div>}
                    </td>
                    {PLAN_YEARS.map((y) => {
                      const amount = plan.byYear.get(y)
                      const overdueHere = plan.overdue && y === FIRST_YEAR
                      return (
                        <td
                          key={y}
                          className={`num year ${yearBand(y)}${amount ? ' has-amount' : ''}${overdueHere ? ' is-overdue' : ''}`}
                          title={overdueHere ? `Past service life — planned for ${FIRST_YEAR}` : undefined}
                        >
                          {formatMoney(amount)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={21 + PLAN_YEARS.length} className="muted table-empty">No assets match your filters.</td></tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={19}>Total</td>
                    <td className="num">{formatMoney(totals.aggregate)}</td>
                    <td className="num estimate-col">{formatMoney(totals.estimate)}</td>
                    {PLAN_YEARS.map((y) => (
                      <td key={y} className={`num year ${yearBand(y)}`}>{totals.byYear.get(y) ? formatMoney(totals.byYear.get(y)) : ''}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="table-note muted">
            Each year shows the aggregate cost (quantity × unit replacement) when the asset is due, repeating every service life,
            increased by {inflationRate}% inflation per year after {FIRST_YEAR}. Assets already past their service life are shown in {FIRST_YEAR}, highlighted in red.
            Aggregate (today) is Qty × Unit Replacement, or, when no unit replacement cost is entered, the Purchase Cost inflated at {inflationRate}% a year from the year installed.
            Est. Replacement Cost is an estimate: the aggregate inflated at {inflationRate}% a year to the asset's replacement year (assets past service life are estimated for {FIRST_YEAR}).
            Useful lives marked "auto" were estimated from the asset name.
          </p>
        </div>
      )}

      {statusFor && (
        <StatusModal asset={statusFor} assets={assets} actor={actor} onDone={setAssets} onClose={() => setStatusFor(null)} />
      )}

      {editing && (
        <AssetFormModal
          asset={editing === 'new' ? undefined : editing}
          existingIds={new Set(assets.map((a) => a.assetId))}
          owners={owners}
          knownAssets={assets}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
