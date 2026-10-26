import type { PlanSettings } from './settings'

export interface ForecastYear {
  year: number
  opening: number
  contribution: number
  interest: number
  spending: number
  closing: number
}

type ForecastInputs = Pick<PlanSettings, 'openingBalance' | 'annualContribution' | 'contributionIncrease' | 'interestRate'>

/**
 * Project the reserve fund year by year:
 * closing = opening + contribution + interest (on a positive opening balance) − replacement spending.
 * The contribution grows by `contributionIncrease`% each year.
 */
export function cashForecast(years: number[], spendingByYear: Map<number, number>, inputs: ForecastInputs): ForecastYear[] {
  const rows: ForecastYear[] = []
  let opening = inputs.openingBalance
  years.forEach((year, i) => {
    const contribution = inputs.annualContribution * Math.pow(1 + inputs.contributionIncrease / 100, i)
    const interest = Math.max(0, opening) * (inputs.interestRate / 100)
    const spending = spendingByYear.get(year) ?? 0
    const closing = opening + contribution + interest - spending
    rows.push({ year, opening, contribution, interest, spending, closing })
    opening = closing
  })
  return rows
}

/**
 * The smallest first-year contribution (growing at the same yearly %) that keeps every closing
 * balance at or above zero. Returns 0 when the fund never runs short even without contributions.
 */
export function minimumContribution(years: number[], spendingByYear: Map<number, number>, inputs: ForecastInputs): number {
  const neverShort = (c: number) => cashForecast(years, spendingByYear, { ...inputs, annualContribution: c }).every((r) => r.closing >= -0.5)
  if (neverShort(0)) return 0
  let low = 0
  let high = Math.max(1, [...spendingByYear.values()].reduce((s, v) => s + v, 0))
  while (!neverShort(high)) high *= 2
  for (let i = 0; i < 60 && high - low > 1; i++) {
    const mid = (low + high) / 2
    if (neverShort(mid)) high = mid
    else low = mid
  }
  return Math.ceil(high)
}
