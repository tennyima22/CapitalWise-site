export interface PlanSettings {
  /** Annual inflation applied to replacement costs, in percent (3 = 3% per year). */
  inflationRate: number
  /** Reserve fund balance at the start of the first plan year, in dollars. */
  openingBalance: number
  /** Contribution to the reserve fund in the first plan year, in dollars. */
  annualContribution: number
  /** Yearly increase in the contribution, in percent. */
  contributionIncrease: number
  /** Interest earned on the reserve fund balance, in percent per year. */
  interestRate: number
}

const STORAGE_KEY = 'capitalwise.settings'
const DEFAULTS: PlanSettings = {
  inflationRate: 3,
  openingBalance: 0,
  annualContribution: 0,
  contributionIncrease: 3,
  interestRate: 2,
}

export function loadSettings(): PlanSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PlanSettings>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function saveSettings(settings: PlanSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable: the setting lasts only for this page load.
  }
}
