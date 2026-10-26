import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { ChartCard, LineChart } from '../../components/charts/Charts'
import { PLAN_YEARS } from '../../data/assets'
import { cashForecast, minimumContribution } from '../../data/cashForecast'
import { loadSettings, saveSettings, type PlanSettings } from '../../data/settings'
import { formatCompactMoney, formatMoney } from '../../lib/format'

type InputKey = 'openingBalance' | 'annualContribution' | 'contributionIncrease' | 'interestRate'

const FIELDS: { key: InputKey; label: string; unit: '$' | '%'; max: number }[] = [
  { key: 'openingBalance', label: `Reserve balance at start of ${PLAN_YEARS[0]}`, unit: '$', max: 1e12 },
  { key: 'annualContribution', label: `Contribution in ${PLAN_YEARS[0]}`, unit: '$', max: 1e12 },
  { key: 'contributionIncrease', label: 'Contribution increase', unit: '%', max: 25 },
  { key: 'interestRate', label: 'Interest earned on balance', unit: '%', max: 25 },
]

const parseInput = (raw: string) => Number(raw.replace(/[$,%\s]/g, ''))

interface CashForecastProps {
  /** Replacement spending per plan year, with inflation, across all departments. */
  spendingByYear: Map<number, number>
  hasCosts: boolean
  inflationRate: number
  /** Name of the department the rest of the dashboard is filtered to, if any. */
  filteredDepartment?: string
}

export default function CashForecast({ spendingByYear, hasCosts, inflationRate, filteredDepartment }: CashForecastProps) {
  const [inputs, setInputs] = useState<Record<InputKey, string>>(() => {
    const s = loadSettings()
    return {
      openingBalance: s.openingBalance.toLocaleString('en-US'),
      annualContribution: s.annualContribution.toLocaleString('en-US'),
      contributionIncrease: String(s.contributionIncrease),
      interestRate: String(s.interestRate),
    }
  })

  const errors = Object.fromEntries(
    FIELDS.map((f) => {
      const n = parseInput(inputs[f.key])
      return [f.key, inputs[f.key].trim() === '' || !Number.isFinite(n) || n < 0 || n > f.max]
    }),
  ) as Record<InputKey, boolean>

  const values = Object.fromEntries(FIELDS.map((f) => [f.key, errors[f.key] ? 0 : parseInput(inputs[f.key])])) as Pick<PlanSettings, InputKey>

  const update = (key: InputKey, raw: string) => {
    setInputs((s) => ({ ...s, [key]: raw }))
    const n = parseInput(raw)
    const field = FIELDS.find((f) => f.key === key)!
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= field.max) saveSettings({ ...loadSettings(), [key]: n })
  }

  const rows = cashForecast(PLAN_YEARS, spendingByYear, values)
  const minimum = minimumContribution(PLAN_YEARS, spendingByYear, values)

  const lowest = rows.reduce((a, b) => (b.closing < a.closing ? b : a), rows[0])
  const firstShort = rows.find((r) => r.closing < 0)
  const shortYears = rows.filter((r) => r.closing < 0).length
  const totalContributions = rows.reduce((s, r) => s + r.contribution, 0)
  const totalSpending = rows.reduce((s, r) => s + r.spending, 0)
  const totalInterest = rows.reduce((s, r) => s + r.interest, 0)
  const ending = rows[rows.length - 1].closing

  const lineData = rows.map((r) => ({
    label: String(r.year),
    value: r.closing,
    details: [
      ['Opening', formatMoney(r.opening)],
      ['+ Contribution', formatMoney(r.contribution)],
      ['+ Interest', formatMoney(r.interest)],
      ['− Replacement spending', formatMoney(r.spending)],
    ] as [string, string][],
  }))

  return (
    <ChartCard
      className="dash-wide"
      title={`Cash forecast ${PLAN_YEARS[0]}–${PLAN_YEARS[PLAN_YEARS.length - 1]}`}
      subtitle={
        <>
          Reserve fund balance at the end of each year: opening balance + contribution + interest − replacement spending
          (with {inflationRate}% inflation).{filteredDepartment && ` Covers all departments, not only ${filteredDepartment}.`}
        </>
      }
      table={{
        headers: ['Year', 'Opening', 'Contribution', 'Interest', 'Replacement spending', 'Closing balance'],
        rows: rows.map((r) => [r.year, formatMoney(r.opening), formatMoney(r.contribution), formatMoney(r.interest), formatMoney(r.spending), formatMoney(r.closing)]),
      }}
    >
      <div className="forecast-inputs">
        {FIELDS.map((f) => (
          <label key={f.key} className="forecast-field">
            <span>{f.label}</span>
            <span className={`input-affix${errors[f.key] ? ' has-error' : ''}`}>
              {f.unit === '$' && <span className="affix">$</span>}
              <input
                value={inputs[f.key]}
                onChange={(e) => update(f.key, e.target.value)}
                onBlur={() => {
                  // Show dollar amounts with thousands separators once the field is left.
                  if (f.unit === '$' && !errors[f.key]) setInputs((s) => ({ ...s, [f.key]: parseInput(s[f.key]).toLocaleString('en-US') }))
                }}
                inputMode="decimal"
                aria-invalid={errors[f.key]}
              />
              {f.unit === '%' && <span className="affix">% / yr</span>}
            </span>
          </label>
        ))}
      </div>

      {!hasCosts ? (
        <div className="forecast-empty">
          <p>No replacement costs entered yet, so there's no spending to forecast.</p>
          <Link to="/assets">Add unit replacement costs on the Asset Register</Link>
        </div>
      ) : (
        <>
          <div className="forecast-summary">
            {firstShort ? (
              <p className="forecast-alert">
                <AlertTriangle size={16} />
                <span>
                  The fund runs short in <strong>{firstShort.year}</strong> and is below zero in {shortYears} of {rows.length} years.
                  Lowest balance: <strong>{formatMoney(lowest.closing)}</strong> in {lowest.year}.
                </span>
              </p>
            ) : (
              <p className="forecast-ok">
                <CheckCircle2 size={16} />
                <span>The fund stays above zero every year. Lowest balance: <strong>{formatMoney(lowest.closing)}</strong> in {lowest.year}.</span>
              </p>
            )}
            <div className="forecast-figures">
              <div><span className="muted">Minimum contribution needed in {PLAN_YEARS[0]}</span><strong>{formatMoney(minimum)}</strong>
                {Math.round(minimum) !== Math.round(values.annualContribution) && (
                  <button type="button" className="link-button" onClick={() => update('annualContribution', minimum.toLocaleString('en-US'))}>Use this amount</button>
                )}
              </div>
              <div><span className="muted">Total contributions</span><strong>{formatCompactMoney(totalContributions)}</strong></div>
              <div><span className="muted">Total interest</span><strong>{formatCompactMoney(totalInterest)}</strong></div>
              <div><span className="muted">Total replacement spending</span><strong>{formatCompactMoney(totalSpending)}</strong></div>
              <div><span className="muted">Balance at end of {PLAN_YEARS[PLAN_YEARS.length - 1]}</span><strong className={ending < 0 ? 'status-critical' : ''}>{formatCompactMoney(ending)}</strong></div>
            </div>
          </div>
          <LineChart data={lineData} formatAxis={formatCompactMoney} formatValue={formatMoney} ariaLabel="Reserve fund closing balance by year" />
          <p className="muted chart-note">
            The minimum contribution grows by {values.contributionIncrease}% a year like the contribution above, and keeps every year's closing balance at or above zero.
            Years below zero are marked in red.
          </p>
        </>
      )}
    </ChartCard>
  )
}
