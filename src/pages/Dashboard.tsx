import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Upload } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../auth/authContext'
import { BarList, ChartCard, ColumnChart, Donut, Meter, type Segment } from '../components/charts/Charts'
import { STATUS } from '../components/charts/colors'
import CashForecast from './dashboard/CashForecast'
import { PLAN_YEARS, aggregateCost, inCapitalPlan, isCancelled, estimatedReplacementCost, loadAssets, replacement, replacementPlan, replacementYears, type Asset } from '../data/assets'
import { departmentSlug, departmentsInUse, matchDepartment } from '../data/departments'
import { loadSettings } from '../data/settings'
import { formatCompact, formatCompactMoney, formatMoney, formatNumber } from '../lib/format'

type Metric = 'cost' | 'count'

const CURRENT_YEAR = new Date().getFullYear()
const FIRST_YEAR = PLAN_YEARS[0]
const LAST_YEAR = PLAN_YEARS[PLAN_YEARS.length - 1]
const SOON_YEARS = 5
const AGE_BANDS: [label: string, min: number, max: number][] = [
  ['0–5 yrs', 0, 5],
  ['6–10 yrs', 6, 10],
  ['11–15 yrs', 11, 15],
  ['16–20 yrs', 16, 20],
  ['21–30 yrs', 21, 30],
  ['31+ yrs', 31, Infinity],
]
const TOP_TYPES = 10

const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`

/** "Refrigerator, True, 2 Door" -> "Refrigerator". */
const assetType = (name: string) => name.replace(/\*/g, '').split(',')[0].trim()

/** Overall data quality out of 100: the average share of assets with each completeness field filled in. */
function qualityRating(score: number) {
  if (score >= 85) return { label: 'Excellent', className: 'score-good' }
  if (score >= 70) return { label: 'Good', className: 'score-good' }
  if (score >= 50) return { label: 'Fair', className: 'score-fair' }
  return { label: 'Needs work', className: 'score-poor' }
}

export default function Dashboard() {
  const { user } = useAuth()
  const firstName = user?.name.split(' ')[0] || 'there'
  // Cancelled records (entered in error) are kept for audit but left out of every figure here.
  const [assets] = useState(() => loadAssets().filter((a) => !isCancelled(a)))
  const [inflationRate] = useState(() => loadSettings().inflationRate)
  const [department, setDepartment] = useState('')

  const hasCosts = assets.some((a) => aggregateCost(a) != null)
  const [metricChoice, setMetric] = useState<Metric>('cost')
  const metric: Metric = hasCosts ? metricChoice : 'count'

  const deptCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assets) {
      const d = matchDepartment(a.structureLocation) ?? 'Unassigned'
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    return m
  }, [assets])

  const scoped = useMemo(
    () => (department ? assets.filter((a) => (matchDepartment(a.structureLocation) ?? 'Unassigned') === department) : assets),
    [assets, department],
  )

  const stats = useMemo(() => buildStats(scoped, inflationRate), [scoped, inflationRate])

  // The reserve fund covers the whole organisation, so the cash forecast always uses every asset.
  const allSpending = useMemo(() => {
    const byYear = new Map<number, number>(PLAN_YEARS.map((y) => [y, 0]))
    for (const a of assets) for (const [y, v] of replacementPlan(a, PLAN_YEARS, inflationRate).byYear) byYear.set(y, byYear.get(y)! + v)
    return byYear
  }, [assets, inflationRate])

  if (assets.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Charts of your asset register, replacement plan and data quality." />
        <div className="card empty-state">
          <h2>No assets yet</h2>
          <p>Import your asset register to see the dashboard.</p>
          <div className="button-row">
            <Link className="button primary with-icon" to="/reports/import"><Upload size={16} /> Import CSV</Link>
          </div>
        </div>
      </>
    )
  }

  const isCost = metric === 'cost'
  const fmt = isCost ? formatMoney : formatNumber
  const fmtAxis = isCost ? formatCompactMoney : formatCompact
  const yearData = PLAN_YEARS.map((y) => ({
    label: String(y),
    value: isCost ? stats.costByYear.get(y)! : stats.countByYear.get(y)!,
    note: isCost ? plural(stats.countByYear.get(y)!, 'asset') : stats.costByYear.get(y) ? formatMoney(stats.costByYear.get(y)) : undefined,
  }))
  const deptData = stats.departments
    .map((d) => ({ label: d.name, value: isCost ? d.cost : d.count, href: d.slug ? `/departments/${d.slug}` : undefined, note: `${plural(d.count, 'asset')}${d.cost ? ` · ${formatMoney(d.cost)}` : ''}` }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const statusSegments: Segment[] = [
    { label: 'Past service life', value: stats.status.overdue, color: STATUS.critical },
    { label: `Due ${FIRST_YEAR}–${FIRST_YEAR + SOON_YEARS - 1}`, value: stats.status.soon, color: STATUS.warning },
    { label: `Due ${FIRST_YEAR + SOON_YEARS} or later`, value: stats.status.later, color: STATUS.good },
    { label: 'Unknown', value: stats.status.unknown, color: STATUS.none, description: 'no install year or service life' },
  ]
  const withinLife = scoped.length ? Math.round(((stats.status.soon + stats.status.later) / scoped.length) * 100) : 0
  const qualityScore = scoped.length
    ? Math.round((stats.completeness.reduce((s, c) => s + c.value / scoped.length, 0) / stats.completeness.length) * 100)
    : 0
  const quality = qualityRating(qualityScore)

  return (
    <>
      <h1 className="greeting">Hello, <strong>{firstName}</strong> — your asset overview</h1>

      <div className="dash-filters">
        <select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
          <option value="">All departments ({formatNumber(assets.length)})</option>
          {[...departmentsInUse(assets), 'Unassigned'].filter((d) => deptCounts.get(d)).map((d) => (
            <option key={d} value={d}>{d} ({formatNumber(deptCounts.get(d)!)})</option>
          ))}
        </select>
        <div className="segmented" role="radiogroup" aria-label="Measure">
          <label className={isCost ? 'is-selected' : ''} title={hasCosts ? undefined : 'No replacement costs entered yet'}>
            <input type="radio" name="metric" checked={isCost} disabled={!hasCosts} onChange={() => setMetric('cost')} />
            Replacement cost
          </label>
          <label className={!isCost ? 'is-selected' : ''}>
            <input type="radio" name="metric" checked={!isCost} onChange={() => setMetric('count')} />
            Number of assets
          </label>
        </div>
        {!hasCosts && <span className="muted">No replacement costs entered yet, so charts count assets.</span>}
      </div>

      <div className="stat-grid">
        <div className="card stat">
          <span className="stat-label">Assets</span>
          <span className="stat-value">{formatNumber(scoped.length)}</span>
          <span className="stat-sub muted">{plural(stats.locationCount, 'refined location')}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Replacement cost <span className="estimate-tag" title={`Estimate: today's cost with ${inflationRate}% yearly inflation to each asset's replacement year`}>Estimate</span></span>
          <span className="stat-value">{stats.costedCount ? formatCompactMoney(stats.estimateTotal) : '—'}</span>
          <span className="stat-sub muted">{stats.costedCount ? `With ${inflationRate}% inflation · ${formatCompactMoney(stats.totalValue)} today` : 'No costs entered'}</span>
        </div>
        <Link className="card stat stat-link" to="/assets?replacement=overdue" title="Show all assets past their service life">
          <span className="stat-label">Past service life</span>
          <span className="stat-value">{formatNumber(stats.status.overdue)}</span>
          <span className="stat-sub status-critical"><AlertTriangle size={13} /> Planned for {FIRST_YEAR} · View all</span>
        </Link>
        <div className="card stat">
          <span className="stat-label">Due {FIRST_YEAR}–{FIRST_YEAR + SOON_YEARS - 1}</span>
          <span className="stat-value">{formatNumber(stats.dueSoonCount)}</span>
          <span className="stat-sub muted">{stats.dueSoonCost ? `${formatCompactMoney(stats.dueSoonCost)} with inflation` : 'assets, including past service life'}</span>
        </div>
        <div className="card stat stat-featured" title="Average share of assets with cost, service life, year installed and register number filled in">
          <span className="stat-label">Data quality</span>
          <span className="stat-value">{qualityScore}/100</span>
          <span className={`stat-sub ${quality.className}`}>{quality.label}</span>
        </div>
      </div>

      <ChartCard
        className="dash-wide"
        title={`Replacement schedule ${FIRST_YEAR}–${LAST_YEAR}`}
        subtitle={
          isCost
            ? <>Total {formatMoney(stats.planCost)} including {inflationRate}% yearly inflation (<Link to="/assets">change on Asset Register</Link>). {stats.status.overdue > 0 && `${FIRST_YEAR} includes ${plural(stats.status.overdue, 'asset')} past service life.`}</>
            : <>Assets due for replacement each year, {formatNumber(stats.planCount)} replacements in total. {stats.status.overdue > 0 && `${FIRST_YEAR} includes ${plural(stats.status.overdue, 'asset')} past service life.`}</>
        }
        table={{ headers: ['Year', 'Assets due', 'Cost with inflation'], rows: PLAN_YEARS.map((y) => [y, formatNumber(stats.countByYear.get(y)!), formatMoney(stats.costByYear.get(y)!)]) }}
      >
        <ColumnChart data={yearData} format={fmt} formatAxis={fmtAxis} ariaLabel={`Replacement ${isCost ? 'cost' : 'count'} by year`} />
      </ChartCard>

      <CashForecast spendingByYear={allSpending} hasCosts={hasCosts} inflationRate={inflationRate} filteredDepartment={department || undefined} />

      <div className="dash-grid">
        <ChartCard
          title="Replacement status"
          subtitle={`Based on year installed + service life, as of ${CURRENT_YEAR}.`}
          table={{ headers: ['Status', 'Assets', 'Share'], rows: statusSegments.map((s) => [s.label, formatNumber(s.value), scoped.length ? `${Math.round((s.value / scoped.length) * 100)}%` : '0%']) }}
        >
          <Donut segments={statusSegments} format={formatNumber} centerValue={`${withinLife}%`} centerLabel="within service life" />
        </ChartCard>

        <ChartCard
          title="Data completeness"
          subtitle="Share of assets with each field filled in."
          table={{ headers: ['Field', 'Assets with value', 'Missing'], rows: stats.completeness.map((c) => [c.label, formatNumber(c.value), formatNumber(scoped.length - c.value)]) }}
        >
          <div className="meters">
            {stats.completeness.map((c) => (
              <Meter key={c.label} label={c.label} value={c.value} total={scoped.length} detail={c.detail} />
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title={isCost ? 'Replacement value by department' : 'Assets by department'}
          subtitle={isCost ? "Today's cost (quantity × unit replacement). Select a department to open it." : 'Select a department to open it.'}
          table={{ headers: ['Department', 'Assets', "Replacement value today"], rows: stats.departments.filter((d) => d.count).map((d) => [d.name, formatNumber(d.count), formatMoney(d.cost)]) }}
        >
          {deptData.length ? <BarList data={deptData} format={isCost ? formatCompactMoney : formatNumber} /> : <p className="muted">No values to show.</p>}
        </ChartCard>

        <ChartCard
          title="Age of assets"
          subtitle={`Years since installation.${stats.ageUnknown ? ` ${plural(stats.ageUnknown, 'asset')} without an install year not shown.` : ''}`}
          table={{ headers: ['Age', 'Assets'], rows: stats.ages.map((a) => [a.label, formatNumber(a.value)]) }}
        >
          <ColumnChart data={stats.ages} format={(n) => plural(n, 'asset')} formatAxis={formatCompact} ariaLabel="Assets by age" height={180} />
        </ChartCard>
      </div>

      <ChartCard
        className="dash-wide"
        title="Most common asset types"
        subtitle={`By the first part of the asset name (e.g. "Vehicle", "Furniture").${stats.otherTypes ? ` ${plural(stats.otherTypes, 'other type')} not shown.` : ''}`}
        table={{ headers: ['Asset type', 'Assets'], rows: stats.types.map((t) => [t.label, formatNumber(t.value)]) }}
      >
        <BarList data={stats.types} format={formatNumber} />
      </ChartCard>
    </>
  )
}

function buildStats(assets: Asset[], inflationRate: number) {
  const countByYear = new Map<number, number>(PLAN_YEARS.map((y) => [y, 0]))
  const costByYear = new Map<number, number>(PLAN_YEARS.map((y) => [y, 0]))
  const status = { overdue: 0, soon: 0, later: 0, unknown: 0 }
  const ageCounts = AGE_BANDS.map(() => 0)
  const typeCounts = new Map<string, { label: string; value: number }>()
  const depts = new Map<string, { name: string; slug?: string; count: number; cost: number }>()
  const locations = new Set<string>()
  let totalValue = 0
  let estimateTotal = 0
  let costedCount = 0
  let ageUnknown = 0
  let dueSoonCount = 0
  let dueSoonCost = 0
  const filled = { cost: 0, life: 0, year: 0, register: 0, auto: 0 }

  for (const a of assets) {
    // Disposed assets keep their record but are left out of replacement value and the plan.
    const agg = inCapitalPlan(a) ? aggregateCost(a) : null
    if (agg != null) {
      totalValue += agg
      estimateTotal += estimatedReplacementCost(a, inflationRate, CURRENT_YEAR)!.amount
      costedCount++
    }

    // Replacement schedule
    for (const y of replacementYears(a).years) countByYear.set(y, countByYear.get(y)! + 1)
    for (const [y, v] of replacementPlan(a, PLAN_YEARS, inflationRate).byYear) {
      costByYear.set(y, costByYear.get(y)! + v)
      if (y < FIRST_YEAR + SOON_YEARS) dueSoonCost += v
    }

    // Status: past service life, due in the next SOON_YEARS plan years (e.g. 2026–2030), or later.
    const { remainingLife } = replacement(a, CURRENT_YEAR)
    if (remainingLife == null) status.unknown++
    else if (remainingLife < 0) status.overdue++
    else if (remainingLife < SOON_YEARS) status.soon++
    else status.later++
    if (remainingLife != null && remainingLife < SOON_YEARS) dueSoonCount++

    // Age
    if (a.yearInstalled == null) ageUnknown++
    else {
      const age = CURRENT_YEAR - a.yearInstalled
      const i = AGE_BANDS.findIndex(([, min, max]) => age >= min && age <= max)
      if (i >= 0) ageCounts[i]++
    }

    // Type
    const type = assetType(a.assetName)
    if (type) {
      const key = type.toLowerCase()
      const t = typeCounts.get(key) ?? { label: type, value: 0 }
      t.value++
      typeCounts.set(key, t)
    }

    // Department
    const dept = matchDepartment(a.structureLocation)
    const key = dept ?? 'Unassigned'
    const d = depts.get(key) ?? { name: key, slug: dept ? departmentSlug(dept) : 'unassigned', count: 0, cost: 0 }
    d.count++
    d.cost += agg ?? 0
    depts.set(key, d)

    if (a.refinedLocation.trim()) locations.add(a.refinedLocation.trim().toLowerCase())
    if (agg != null) filled.cost++
    if (a.serviceLifeYears != null) filled.life++
    if (a.serviceLifeAuto) filled.auto++
    if (a.yearInstalled != null) filled.year++
    if (a.registerNumber.trim()) filled.register++
  }

  const sortedTypes = [...typeCounts.values()].sort((x, y) => y.value - x.value)

  return {
    countByYear,
    costByYear,
    planCount: [...countByYear.values()].reduce((s, n) => s + n, 0),
    planCost: [...costByYear.values()].reduce((s, n) => s + n, 0),
    status,
    dueSoonCount,
    dueSoonCost,
    totalValue,
    estimateTotal,
    costedCount,
    locationCount: locations.size,
    ages: AGE_BANDS.map(([label], i) => ({ label, value: ageCounts[i] })),
    ageUnknown,
    types: sortedTypes.slice(0, TOP_TYPES),
    otherTypes: Math.max(0, sortedTypes.length - TOP_TYPES),
    departments: [...depts.values()],
    completeness: [
      { label: 'Cost (purchase or unit replacement)', value: filled.cost, detail: filled.cost < assets.length ? <Link to="/assets">Add costs on the Asset Register</Link> : undefined },
      { label: 'Asset service life', value: filled.life, detail: filled.auto ? `${plural(filled.auto, 'value')} estimated from the asset name` : undefined },
      { label: 'Year installed', value: filled.year },
      { label: 'Register number', value: filled.register },
    ],
  }
}
