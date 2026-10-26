import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Boxes, CalendarClock, Upload, Wallet, type LucideIcon } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import CashForecast from '../dashboard/CashForecast'
import { effectiveStatus, isCancelled, ASSET_STATUSES, PLAN_YEARS, estimatedReplacementCost, loadAssets, replacement, replacementPlan, type Asset, type AssetStatus } from '../../data/assets'
import StatusPill, { FlagMark } from '../../components/StatusPill'
import { departmentSlug, matchDepartment } from '../../data/departments'
import { loadSettings } from '../../data/settings'
import { formatCompactMoney, formatMoney, formatNumber } from '../../lib/format'

const CURRENT_YEAR = new Date().getFullYear()
const FIRST_YEAR = PLAN_YEARS[0]
const LAST_YEAR = PLAN_YEARS[PLAN_YEARS.length - 1]
/** "Due for replacement" window: this year and the next two (e.g. 2026–2028). */
const UPCOMING_YEARS = 3
const LAST_UPCOMING_YEAR = CURRENT_YEAR + UPCOMING_YEARS - 1
const MAX_ROWS = 100

type Filter = 'all' | 'overdue' | 'upcoming'

interface UpcomingRow {
  asset: Asset
  replacementYear: number
  overdue: boolean
  /** Cost in the year it is planned (with inflation), if the asset has a cost. */
  cost: number | null
}

const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`

export default function CapitalReservePlan() {
  // Cancelled records (entered in error) are kept for audit but left out of every figure here.
  const [assets] = useState(() => loadAssets().filter((a) => !isCancelled(a)))
  const [inflationRate] = useState(() => loadSettings().inflationRate)
  const [filter, setFilter] = useState<Filter>('all')

  const summary = useMemo(() => {
    const spending = new Map<number, number>(PLAN_YEARS.map((y) => [y, 0]))
    const rows: UpcomingRow[] = []
    let estimate = 0
    let today = 0
    let costed = 0
    let upcoming = 0
    let overdue = 0

    for (const a of assets) {
      const est = estimatedReplacementCost(a, inflationRate, CURRENT_YEAR)
      if (est) {
        estimate += est.amount
        today += est.today
        costed++
      }
      const plan = replacementPlan(a, PLAN_YEARS, inflationRate)
      for (const [y, v] of plan.byYear) spending.set(y, spending.get(y)! + v)

      const { replacementYear } = replacement(a, CURRENT_YEAR)
      if (replacementYear == null) continue
      const isOverdue = replacementYear < CURRENT_YEAR
      const isUpcoming = !isOverdue && replacementYear <= LAST_UPCOMING_YEAR
      if (isOverdue) overdue++
      if (isUpcoming) upcoming++
      if (isOverdue || isUpcoming) {
        const plannedYear = Math.max(replacementYear, FIRST_YEAR)
        rows.push({ asset: a, replacementYear, overdue: isOverdue, cost: plan.byYear.get(plannedYear) ?? null })
      }
    }

    rows.sort((x, y) => x.replacementYear - y.replacementYear || x.asset.assetName.localeCompare(y.asset.assetName))
    const planTotal = [...spending.values()].reduce((s, v) => s + v, 0)
    return {
      spending,
      rows,
      estimate,
      today,
      costed,
      upcoming,
      overdue,
      budgetThisYear: spending.get(FIRST_YEAR) ?? 0,
      averageAnnual: planTotal / PLAN_YEARS.length,
      upcomingCost: rows.reduce((s, r) => s + (r.cost ?? 0), 0),
    }
  }, [assets, inflationRate])

  if (assets.length === 0) {
    return (
      <>
        <PageHeader title="Capital Reserve Plan" description="Forecast replacements and plan reserve funding over time." />
        <div className="card empty-state">
          <h2>No assets yet</h2>
          <p>Import your asset register to build the capital reserve plan.</p>
          <div className="button-row">
            <Link className="button primary with-icon" to="/reports/import"><Upload size={16} /> Import CSV</Link>
          </div>
        </div>
      </>
    )
  }

  const hasCosts = summary.costed > 0
  const statusCounts = Object.fromEntries(ASSET_STATUSES.map((s) => [s, assets.filter((a) => effectiveStatus(a) === s).length])) as Record<AssetStatus, number>
  const visibleRows = summary.rows.filter((r) => (filter === 'overdue' ? r.overdue : filter === 'upcoming' ? !r.overdue : true))

  return (
    <>
      <PageHeader title="Capital Reserve Plan" description="Forecast replacements and plan reserve funding over time." />

      <h2 className="section-title">Overall capital reserve overview</h2>
      <div className="overview-grid">
        <OverviewTile
          icon={Boxes}
          label="Total Assets"
          value={formatNumber(statusCounts.Active)}
          caption={
            <>
              Number of active assets
              {statusCounts.Overdue > 0 && ` · plus ${formatNumber(statusCounts.Overdue)} overdue`}
              {statusCounts.Disposed > 0 && ` · ${formatNumber(statusCounts.Disposed)} disposed (not in the plan)`}
            </>
          }
        />
        <OverviewTile
          icon={Wallet}
          label="Replacement Cost"
          estimate={hasCosts}
          value={hasCosts ? formatMoney(summary.estimate) : '—'}
          caption={
            hasCosts
              ? <>
                  Estimated cost in each asset's replacement year with {inflationRate}% yearly inflation · {formatMoney(summary.today)} in today's dollars
                  {summary.costed < assets.length && ` · ${plural(assets.length - summary.costed, 'asset')} without a cost`}
                </>
              : <>No costs entered yet · <Link to="/assets">add on the Asset Register</Link></>
          }
        />
        <OverviewTile
          icon={CalendarClock}
          label="Due for Replacement"
          value={formatNumber(summary.upcoming)}
          caption={`Assets due ${CURRENT_YEAR}–${LAST_UPCOMING_YEAR} (within ${UPCOMING_YEARS} years)${summary.overdue ? ` · plus ${formatNumber(summary.overdue)} past service life` : ''}`}
        />
        <OverviewTile
          icon={BarChart3}
          label="Capital Budget"
          value={hasCosts ? formatMoney(summary.budgetThisYear) : '—'}
          caption={
            hasCosts
              ? `Forecast capital requirement for ${FIRST_YEAR} · avg ${formatCompactMoney(summary.averageAnnual)}/yr to ${LAST_YEAR}`
              : 'Forecast capital requirements, once costs are entered'
          }
        />
      </div>

      <section className="card table-card upcoming-card">
        <div className="upcoming-header">
          <div>
            <h2>Upcoming replacements</h2>
            <p className="muted">
              Past service life and due {CURRENT_YEAR}–{LAST_UPCOMING_YEAR}.
              {hasCosts && ` ${formatMoney(summary.upcomingCost)} with ${inflationRate}% inflation.`}
            </p>
          </div>
          <div className="chips" role="group" aria-label="Filter">
            {([
              ['all', `All (${summary.rows.length})`],
              ['overdue', `Past service life (${summary.overdue})`],
              ['upcoming', `Due ${CURRENT_YEAR}–${LAST_UPCOMING_YEAR} (${summary.upcoming})`],
            ] as const).map(([value, label]) => (
              <button key={value} className={`chip${filter === value ? ' is-selected' : ''}`} onClick={() => setFilter(value)}>{label}</button>
            ))}
          </div>
        </div>

        {visibleRows.length === 0 ? (
          <p className="muted table-empty">Nothing due in this view.</p>
        ) : (
          <div className="table-wrap flush upcoming-wrap">
            <table className="table upcoming-table">
              <thead>
                <tr>
                  <th>Replacement</th>
                  <th>Asset</th>
                  <th>Status</th>
                  <th>Department</th>
                  <th>Location</th>
                  <th className="num">Quantity</th>
                  <th className="num">Est. cost when due <span className="estimate-tag" title={`Estimate: today's cost with ${inflationRate}% yearly inflation to the replacement year`}>Estimate</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.slice(0, MAX_ROWS).map(({ asset: a, replacementYear, overdue, cost }) => {
                  const dept = matchDepartment(a.structureLocation)
                  return (
                    <tr key={a.assetId}>
                      <td className="nowrap">
                        <span className="replacement">
                          {replacementYear}
                          {overdue ? <span className="pill danger">Overdue</span> : <span className="pill warning">{replacementYear === CURRENT_YEAR ? 'This year' : `In ${replacementYear - CURRENT_YEAR} yr${replacementYear - CURRENT_YEAR === 1 ? '' : 's'}`}</span>}
                        </span>
                      </td>
                      <td>
                        <div className="cell-strong"><FlagMark asset={a} />{a.assetName}</div>
                        <div className="muted">{[a.assetId, a.registerNumber].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="nowrap"><StatusPill asset={a} /></td>
                      <td>{dept ? <Link to={`/departments/${departmentSlug(dept)}`} className="table-link">{dept}</Link> : <span className="muted">Unassigned</span>}</td>
                      <td>
                        <div>{a.refinedLocation}</div>
                        <div className="muted">{a.roomArea}</div>
                      </td>
                      <td className="num nowrap">{formatNumber(a.quantity)} {a.unitOfMeasure}</td>
                      <td className="num">{cost != null ? formatMoney(cost) : <span className="muted">No cost</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {visibleRows.length > MAX_ROWS && (
          <p className="table-note muted">Showing the first {MAX_ROWS} of {formatNumber(visibleRows.length)}. See the full list on the <Link to="/assets">Asset Register</Link>.</p>
        )}
      </section>

      <CashForecast spendingByYear={summary.spending} hasCosts={hasCosts} inflationRate={inflationRate} />
    </>
  )
}

function OverviewTile({ icon: Icon, label, value, caption, estimate = false }: { icon: LucideIcon; label: string; value: string; caption: ReactNode; estimate?: boolean }) {
  return (
    <div className="card overview-tile">
      <Icon size={20} strokeWidth={1.75} className="overview-icon" />
      <span className="overview-label">
        {label}
        {estimate && <span className="estimate-tag">Estimate</span>}
      </span>
      <span className="overview-value">{value}</span>
      <span className="overview-caption">{caption}</span>
    </div>
  )
}
