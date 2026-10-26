import { matchDepartment } from './departments'
import { loadSettings } from './settings'

export interface Asset {
  structureLocation: string
  refinedLocation: string
  /** Project number the asset belongs to, if any. */
  majorProject: string
  roomArea: string
  owner: string
  assetId: string
  registerNumber: string
  assetName: string
  quantity: number | null
  unitOfMeasure: string
  ledgerId: string
  yearInstalled: number | null
  serviceLifeYears: number | null
  /** True when the service life was estimated from the asset name rather than entered. */
  serviceLifeAuto: boolean
  unitReplacementCost: number | null
  /** Total paid for the line when installed (all units), in installation-year dollars. */
  purchaseCost: number | null
  /** Invoice number for the purchase. */
  invoiceNumber: string
  /** Whether the asset is in use. Disposed assets are left out of the capital plan. */
  status: AssetStatus
  /** Who added the asset and who approved it (new assets wait as Pending Approval). */
  addition?: AdditionRecord
  /** Disposal details: captured when disposal is requested, completed when it is approved. */
  disposal?: DisposalRecord
  /** The asset this one replaced (successor / linked asset). */
  replacesAssetId?: string
  /** The asset that replaced this one. */
  replacedByAssetId?: string
  /** Why the record was cancelled (entered in error); cancelled records are kept, not deleted. */
  cancelReason?: string
}

export interface AdditionRecord {
  requestedBy: string
  requestedByEmail: string
  requestedAt: string
  approvedBy?: string
  approvedAt?: string
}

export interface DisposalRecord {
  /** When the asset was (or will be) taken out of service, YYYY-MM-DD. */
  date: string
  reason: string
  reference: string
  /** Amount received for the asset (sale, auction or trade-in); 0 when scrapped, lost or stolen. */
  price?: number | null
  requestedBy: string
  requestedByEmail: string
  requestedAt: string
  /** Status to return to if the request is rejected. */
  previousStatus: AssetStatus
  approvedBy?: string
  approvedAt?: string
}

/**
 * Lifecycle: Pending Approval (new) -> Active -> Overdue -> Pending Disposal -> Disposed. Cancelled
 * marks a record entered in error or a rejected addition; it is hidden from normal views but never deleted.
 */
export const ASSET_STATUSES = ['Pending Approval', 'Active', 'Overdue', 'Pending Disposal', 'Disposed', 'Cancelled'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

/** Other words used for each status in spreadsheets. */
const STATUS_ALIASES: Record<string, AssetStatus> = {
  active: 'Active', inuse: 'Active', inservice: 'Active', operational: 'Active', good: 'Active',
  undermaintenance: 'Active', maintenance: 'Active', inrepair: 'Active', repair: 'Active',
  overdue: 'Overdue', pastservicelife: 'Overdue', flaggedforreplacement: 'Overdue', flagged: 'Overdue', replace: 'Overdue',
  needsreplacement: 'Overdue', replacementneeded: 'Overdue', toreplace: 'Overdue',
  outofservice: 'Overdue', outoforder: 'Overdue', broken: 'Overdue', poor: 'Overdue',
  pendingapproval: 'Pending Approval', awaitingapproval: 'Pending Approval',
  pendingdisposal: 'Pending Disposal', awaitingdisposal: 'Pending Disposal', disposalpending: 'Pending Disposal',
  cancelled: 'Cancelled', canceled: 'Cancelled', error: 'Cancelled', enteredinerror: 'Cancelled', void: 'Cancelled',
  disposed: 'Disposed', retired: 'Disposed', sold: 'Disposed', scrapped: 'Disposed', writtenoff: 'Disposed', removed: 'Disposed', replaced: 'Disposed', inactive: 'Disposed',
}

/** The status a typed or imported value means, or undefined if it isn't recognised. */
export function matchStatus(value: string): AssetStatus | undefined {
  return STATUS_ALIASES[value.toLowerCase().replace(/[^a-z]/g, '')]
}

/**
 * Disposed assets are no longer replaced, so they drop out of costs, schedules and forecasts.
 * Overdue is a marker only: the asset keeps its normal replacement year.
 */
export const inCapitalPlan = (asset: Pick<Asset, 'status'>) =>
  asset.status !== 'Disposed' && asset.status !== 'Cancelled' && asset.status !== 'Pending Approval'

/** Cancelled records (entered in error) are kept for the audit trail but hidden from normal views. */
export const isCancelled = (asset: Pick<Asset, 'status'>) => asset.status === 'Cancelled'

/** Disposed assets keep their historical figures fixed so they can't be changed by accident. */
export const LOCKED_WHEN_DISPOSED: (keyof Asset)[] = ['assetId', 'yearInstalled', 'purchaseCost', 'unitReplacementCost', 'quantity', 'serviceLifeYears']
export const isLocked = (asset: Pick<Asset, 'status'> | undefined) => asset?.status === 'Disposed' || asset?.status === 'Cancelled'

/**
 * True when an Active asset is past its service life: it is then shown and counted as
 * Overdue automatically (worked out each time, so it follows the calendar).
 */
export function isAutoFlagged(asset: Asset, currentYear = new Date().getFullYear()) {
  if (asset.status !== 'Active') return false
  const { remainingLife } = replacement(asset, currentYear)
  return remainingLife != null && remainingLife < 0
}

/** The status to show, filter and count by: the saved status, or Overdue when past service life. */
export function effectiveStatus(asset: Asset): AssetStatus {
  return isAutoFlagged(asset) ? 'Overdue' : asset.status
}

const EMPTY_ASSET: Asset = {
  structureLocation: '',
  refinedLocation: '',
  majorProject: '',
  roomArea: '',
  owner: '',
  assetId: '',
  registerNumber: '',
  assetName: '',
  quantity: null,
  unitOfMeasure: '',
  ledgerId: '',
  yearInstalled: null,
  serviceLifeYears: null,
  serviceLifeAuto: false,
  unitReplacementCost: null,
  purchaseCost: null,
  invoiceNumber: '',
  status: 'Active',
}

export type ColumnType = 'text' | 'department' | 'status' | 'quantity' | 'year' | 'years' | 'money'

export interface AssetColumn {
  key: keyof Asset
  label: string
  type: ColumnType
  required: boolean
  /** Other header spellings accepted on import. */
  aliases?: string[]
}

export const ASSET_COLUMNS: AssetColumn[] = [
  // The structure location is the department the asset belongs to.
  { key: 'structureLocation', label: 'Structure Location Name', type: 'department', required: true, aliases: ['Structure Location', 'Structure', 'Department'] },
  { key: 'refinedLocation', label: 'Refined Location', type: 'text', required: false },
  { key: 'majorProject', label: 'Project Number', type: 'text', required: false, aliases: ['Major Project (if applicable)', 'Major Project', 'Project', 'Project No', 'Project #'] },
  { key: 'roomArea', label: 'Room/Area Name', type: 'text', required: false, aliases: ['Room Area Name', 'Room-Area Name', 'Room/Area', 'Room', 'Area'] },
  { key: 'owner', label: 'Owner', type: 'text', required: false, aliases: ['Asset Owner', 'Owner Name'] },
  { key: 'assetId', label: 'Asset ID', type: 'text', required: true },
  { key: 'registerNumber', label: 'Register Number', type: 'text', required: false, aliases: ['Register No', 'Register #'] },
  { key: 'ledgerId', label: 'Ledger Number', type: 'text', required: false, aliases: ['Ledger ID', 'Ledger Id', 'Ledger No', 'Ledger #', 'Ledger', 'GL Account', 'GL'] },
  { key: 'assetName', label: 'Asset Name', type: 'text', required: true },
  { key: 'status', label: 'Status', type: 'status', required: false, aliases: ['Asset Status', 'Condition Status'] },
  { key: 'quantity', label: 'Quantity', type: 'quantity', required: true, aliases: ['Qty'] },
  { key: 'unitOfMeasure', label: 'Unit of Measurement', type: 'text', required: false, aliases: ['Unit of Measure', 'UOM', 'Unit'] },
  { key: 'yearInstalled', label: 'Year Installed', type: 'year', required: false, aliases: ['Install Year', 'Installed'] },
  { key: 'serviceLifeYears', label: 'Asset Service Life', type: 'years', required: false, aliases: ['Asset Service Life (Years)', 'Service Life', 'Useful Life'] },
  { key: 'unitReplacementCost', label: 'Unit Replacement Cost', type: 'money', required: false, aliases: ['Unit Replacement', 'Unit Replacement Value', 'Replacement Cost', 'Unit Cost'] },
  { key: 'purchaseCost', label: 'Purchase Cost', type: 'money', required: false, aliases: ['Purchase Price', 'Original Cost', 'Acquisition Cost', 'Historical Cost', 'Installed Cost'] },
  { key: 'invoiceNumber', label: 'Invoice Number', type: 'text', required: false, aliases: ['Invoice No', 'Invoice #', 'Invoice'] },
]

// Sample rows as they'd appear in a spreadsheet. Structure Location Name is the department;
// service life can be a single number or a range (the average is used).
const SAMPLE: Partial<Record<keyof Asset, string>>[] = [
  { structureLocation: 'Administration', refinedLocation: 'Staff Offices', roomArea: 'Administration', owner: 'General Manager', assetId: '19-1-0001', assetName: 'Furniture, Desk Set GM', status: 'Active', quantity: '1', unitOfMeasure: 'Ea', yearInstalled: '2013', serviceLifeYears: '15 to 18', purchaseCost: '5000' },
  { structureLocation: 'F&B Front', refinedLocation: 'Main Restaurant', roomArea: 'Family Dining', owner: 'F&B Manager', assetId: '11-1-0001', assetName: 'Furniture, Chair, Leather', status: 'Active', quantity: '24', unitOfMeasure: 'Ea', yearInstalled: '2022', serviceLifeYears: '12 to 15', purchaseCost: '11000' },
  { structureLocation: 'F&B Back', refinedLocation: 'Kitchen', roomArea: 'Kitchen', owner: 'F&B Manager', assetId: '20-1-0001', assetName: 'Dishwasher, Hobart, 2 Door Conveyor', status: 'Active', quantity: '1', unitOfMeasure: 'Ea', yearInstalled: '2021', serviceLifeYears: '18 to 20', purchaseCost: '60000' },
  { structureLocation: 'Golf Shop', refinedLocation: 'Teaching Facility', roomArea: 'Teaching Center', owner: 'Head Professional', assetId: '45-1-0001', assetName: 'Heater, Suspended Gas', status: 'Active', quantity: '5', unitOfMeasure: 'Ea', yearInstalled: '1995', serviceLifeYears: '20 to 25', purchaseCost: '20000' },
  { structureLocation: 'Facilities', refinedLocation: 'RTU', roomArea: 'Building Services', owner: 'Facilities Manager', assetId: '80-1-0001', assetName: 'Roof Top Unit, York, RTU-7 Pro Shop Hallway, 7 Ton', status: 'Active', quantity: '1', unitOfMeasure: 'Ea', yearInstalled: '2017', serviceLifeYears: '18 to 20', purchaseCost: '30000' },
  { structureLocation: 'Turf Equipment', refinedLocation: 'TC Equipment', roomArea: 'Equipment, Owned', owner: 'Superintendent', assetId: '40-1-0001', assetName: 'Mower, Toro, Triflex, 3300', status: 'Active', quantity: '1', unitOfMeasure: 'Ea', yearInstalled: '2012', serviceLifeYears: '10 to 12', purchaseCost: '55000' },
  { structureLocation: 'Course Irrigation', refinedLocation: 'South Course', roomArea: 'Irrigation, North & South Courses', owner: 'Superintendent', assetId: '33-1-0001', assetName: 'Pump & Motor, Main 100 HP Rebuild', status: 'Overdue', quantity: '1', unitOfMeasure: 'Ea', yearInstalled: '2008', serviceLifeYears: '10 to 12', purchaseCost: '35000' },
  { structureLocation: 'Golf Course', refinedLocation: 'Lakes/Slopes', roomArea: 'North Course', owner: 'Superintendent', assetId: '30-1-0001', assetName: 'Greens, USGA Renovation', status: 'Active', quantity: '110000', unitOfMeasure: 'Sq Ft', yearInstalled: '2014', serviceLifeYears: '18 to 20', purchaseCost: '1300000' },
  { structureLocation: 'Turf Building', refinedLocation: 'Turfcare Main', roomArea: 'Facility', owner: 'Superintendent', assetId: '45-1-0002', assetName: 'Roof Assembly, Main Building, Metal', status: 'Active', quantity: '7400', unitOfMeasure: 'Sq Ft', yearInstalled: '2005', serviceLifeYears: '30 to 35', purchaseCost: '130000' },
  { structureLocation: 'Events', refinedLocation: 'Banquet Room', roomArea: 'Food & Beverage', owner: 'F&B Manager', assetId: '20-1-0002', assetName: 'Furniture, Banquet Chair White Resin', status: 'Active', quantity: '200', unitOfMeasure: 'Ea', yearInstalled: '2020', serviceLifeYears: 'to 10', purchaseCost: '10000' },
]

// The sample leaves out Unit Replacement Cost (import still accepts it) and Register Number, which
// the website generates for every asset on upload and includes in exports.
export const SAMPLE_COLUMNS = ASSET_COLUMNS.filter((c) => c.key !== 'unitReplacementCost' && c.key !== 'registerNumber')

/** Header row for the sample file; the structure location column is titled "Department" (import accepts both). */
export const SAMPLE_HEADERS = SAMPLE_COLUMNS.map((c) => (c.key === 'structureLocation' ? 'Department' : c.label))

export const SAMPLE_ROWS: string[][] = SAMPLE.map((row) => SAMPLE_COLUMNS.map((c) => row[c.key] ?? ''))

/**
 * Read a service life in whole years: "15", "12 to 15", "12-15" or "to 20". A range returns its
 * average rounded down (12 to 15 -> 13, 10 to 12 -> 11); "to 20" means up to 20 years. A single
 * value must be a whole number.
 */
export function parseServiceLife(value: string): number | null {
  const m = value.trim().toLowerCase().match(/^(?:(\d+)\s*(?:to|-|–)\s*|to\s*)?(\d+)\s*(?:yrs?|years?)?$/)
  if (!m) return null
  const high = Number(m[2])
  const low = m[1] != null ? Number(m[1]) : high
  return low <= high ? Math.floor((low + high) / 2) : null
}

const MAX_YEAR = new Date().getFullYear() + 1

/** Convert one raw field to its typed value, or return an error message. Shared by import and the asset form. */
export function parseField(col: AssetColumn, raw: string): { value: string | number | null; error?: string } {
  const value = raw.trim()
  if (col.type === 'text') return { value }
  if (col.type === 'status') {
    if (value === '') return { value: 'Active' }
    const status = matchStatus(value)
    return status ? { value: status } : { value: 'Active', error: `${col.label} must be one of: ${ASSET_STATUSES.join(', ')}` }
  }
  if (col.type === 'department') {
    if (value === '') return { value: '' }
    // Any department name is accepted; standard names and aliases are normalised here, and
    // spelling mistakes are corrected against known departments when a file is imported.
    return { value: matchDepartment(value) ?? '' }
  }
  if (value === '') return { value: null }
  if (col.type === 'years') {
    const life = parseServiceLife(value)
    return life != null && life > 0
      ? { value: life }
      : { value: null, error: `${col.label} must be a whole number of years (e.g. 13), or a range like "12 to 15"` }
  }
  const n = Number(value.replace(/[$,\s]/g, ''))
  switch (col.type) {
    case 'quantity':
      return Number.isFinite(n) && n > 0 ? { value: n } : { value: null, error: `${col.label} must be a number greater than 0` }
    case 'year':
      return Number.isInteger(n) && n >= 1800 && n <= MAX_YEAR ? { value: n } : { value: null, error: `${col.label} must be a 4-digit year (1800–${MAX_YEAR})` }
    case 'money':
      return Number.isFinite(n) && n >= 0 ? { value: Math.round(n * 100) / 100 } : { value: null, error: `${col.label} must be an amount of 0 or more` }
  }
}

const STORAGE_KEY = 'capitalwise.assets.v2'

export function loadAssets(): Asset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // Fill in fields added after the asset was saved.
    return raw
      ? (JSON.parse(raw) as Partial<Asset>[]).map((a) => {
          const asset = { ...EMPTY_ASSET, ...a }
          // Statuses saved under earlier names (e.g. "Flagged for Replacement", "Retired", "Out of Service").
          asset.status = ASSET_STATUSES.includes(asset.status) ? asset.status : (matchStatus(String(asset.status)) ?? 'Active')
          // Useful life is whole years; round down values saved before that rule (13.5 -> 13).
          if (asset.serviceLifeYears != null) asset.serviceLifeYears = Math.floor(asset.serviceLifeYears)
          return asset
        })
      : []
  } catch {
    return []
  }
}

export function saveAssets(assets: Asset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assets))
  } catch {
    // Storage unavailable: changes last only for this page load.
  }
}

/** Remove every asset from the register. */
export function clearAssets() {
  saveAssets([])
}

/** Add new assets and replace existing ones with the same Asset ID. */
export function upsertAssets(incoming: Asset[]): { added: number; updated: number } {
  const byId = new Map(loadAssets().map((a) => [a.assetId, a]))
  let added = 0
  let updated = 0
  for (const asset of incoming) {
    if (byId.has(asset.assetId)) updated++
    else added++
    byId.set(asset.assetId, asset)
  }
  saveAssets([...byId.values()])
  return { added, updated }
}

/** Year the asset is due for replacement and years left, based on install year + service life. */
export function replacement(asset: Asset, currentYear = new Date().getFullYear()) {
  if (!inCapitalPlan(asset)) return { replacementYear: null, remainingLife: null }
  const replacementYear = expiryYear(asset)
  if (replacementYear == null) return { replacementYear: null, remainingLife: null }
  return { replacementYear, remainingLife: replacementYear - currentYear }
}

/** Whether an asset matches an expiry-year filter: '' (all), 'none' (no expiry year) or a year like '2028'. */
export function matchesExpiry(asset: Pick<Asset, 'yearInstalled' | 'serviceLifeYears'>, filter: string) {
  if (!filter) return true
  const year = expiryYear(asset)
  return filter === 'none' ? year == null : year != null && String(year) === filter
}

/** Year the asset reaches the end of its service life: Year Installed + Asset Service Life. */
export function expiryYear(asset: Pick<Asset, 'yearInstalled' | 'serviceLifeYears'>): number | null {
  if (asset.yearInstalled == null || asset.serviceLifeYears == null) return null
  return Math.round(asset.yearInstalled + asset.serviceLifeYears)
}

/**
 * Replacement cost today for the whole line. Uses Quantity × Unit Replacement Cost when a unit
 * cost is entered; otherwise the Purchase Cost inflated from the year installed to this year.
 */
export function aggregateCost(asset: Asset, inflationRate = loadSettings().inflationRate, currentYear = PLAN_START_YEAR): number | null {
  if (asset.quantity != null && asset.unitReplacementCost != null) return asset.quantity * asset.unitReplacementCost
  if (asset.purchaseCost == null) return null
  return asset.yearInstalled == null ? asset.purchaseCost : inflate(asset.purchaseCost, currentYear, inflationRate, asset.yearInstalled)
}

/** Where an asset's replacement cost comes from. */
export function costSource(asset: Asset): 'unit' | 'purchase' | null {
  if (asset.quantity != null && asset.unitReplacementCost != null) return 'unit'
  return asset.purchaseCost != null ? 'purchase' : null
}

/** The planning horizon: this year plus the next 18 (19 years, e.g. 2026–2044). */
export const PLAN_START_YEAR = new Date().getFullYear()
export const PLAN_YEARS = Array.from({ length: 19 }, (_, i) => PLAN_START_YEAR + i)

/**
 * Estimated replacement cost: today's aggregate cost inflated to the year the asset is due.
 * Assets past their service life are estimated for this year; assets without an install year
 * or service life keep today's cost. Returns null when the asset has no cost.
 */
export function estimatedReplacementCost(asset: Asset, inflationRate: number, currentYear = PLAN_START_YEAR) {
  if (!inCapitalPlan(asset)) return null
  const today = aggregateCost(asset, inflationRate, currentYear)
  if (today == null) return null
  const { replacementYear } = replacement(asset, currentYear)
  const year = replacementYear == null ? null : Math.max(replacementYear, currentYear)
  return { today, year, amount: year == null ? today : inflate(today, year, inflationRate, currentYear) }
}

/** Cost in `year` of something that costs `amount` today, at `inflationRate`% per year. */
export function inflate(amount: number, year: number, inflationRate: number, baseYear = PLAN_START_YEAR) {
  return amount * Math.pow(1 + inflationRate / 100, Math.max(0, year - baseYear))
}

/**
 * Replacement spend per plan year. The aggregate cost (in today's dollars) falls in the replacement
 * year and repeats every service life, increased by `inflationRate`% for each year after this one.
 * Assets already past their service life are planned for the first plan year.
 */
export function replacementPlan(asset: Asset, years: number[] = PLAN_YEARS, inflationRate = loadSettings().inflationRate) {
  const byYear = new Map<number, number>()
  const aggregate = aggregateCost(asset, inflationRate, years[0])
  const { years: due, overdue } = replacementYears(asset, years)
  if (aggregate == null) return { aggregate, byYear, overdue: false }
  for (const y of due) byYear.set(y, inflate(aggregate, y, inflationRate, years[0]))
  return { aggregate, byYear, overdue }
}

/**
 * The plan years in which the asset is due for replacement (whether or not it has a cost).
 * Assets already past their service life are due in the first plan year.
 */
export function replacementYears(asset: Asset, years: number[] = PLAN_YEARS): { years: number[]; overdue: boolean } {
  const { replacementYear } = replacement(asset)
  const life = asset.serviceLifeYears
  const first = years[0]
  const last = years[years.length - 1]
  if (replacementYear == null || !life) return { years: [], overdue: false }

  const due: number[] = []
  const start = Math.max(replacementYear, first)
  for (let k = 0; ; k++) {
    const y = Math.round(start + k * life)
    if (y > last) break
    due.push(y)
  }
  return { years: due, overdue: replacementYear < first }
}
