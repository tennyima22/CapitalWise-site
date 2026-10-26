import { useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import { ASSET_COLUMNS, PLAN_YEARS, effectiveStatus, expiryYear, estimatedReplacementCost, loadAssets, replacement, replacementPlan, replacementYears, type Asset, type AssetColumn } from '../../data/assets'
import { loadSettings } from '../../data/settings'
import { exportExcel, exportPdf, type Cell, type ExportColumn, type ExportTable } from '../../lib/exporters'

type Dataset = 'register' | 'replacement'
type Format = 'xlsx' | 'pdf'

const DATASETS: { value: Dataset; label: string; text: string }[] = [
  { value: 'register', label: 'Asset Register', text: 'Every asset with all its fields.' },
  { value: 'replacement', label: 'Replacement Schedule', text: `Replacement year, aggregate cost and the ${PLAN_YEARS[0]}–${PLAN_YEARS[PLAN_YEARS.length - 1]} spend by year with ${loadSettings().inflationRate}% annual inflation (set on the Asset Register page), soonest first.` },
]

const FORMATS: { value: Format; label: string; icon: typeof FileText; hint: string }[] = [
  { value: 'xlsx', label: 'Excel', icon: FileSpreadsheet, hint: 'Every column, with filters and money formatting. Opens in Excel, Google Sheets and Numbers.' },
  { value: 'pdf', label: 'PDF', icon: FileText, hint: 'A print-ready landscape report with the key columns. Use Excel for every column.' },
]

const KIND: Partial<Record<AssetColumn['type'], ExportColumn['kind']>> = { money: 'money', quantity: 'number', years: 'number', year: 'year' }
/** Register columns left out of the PDF so the table fits a landscape page. */
const REGISTER_PDF_SKIP = new Set<keyof Asset>(['majorProject', 'roomArea', 'owner', 'ledgerId', 'invoiceNumber'])

const col = (header: string, kind?: ExportColumn['kind'], pdf = true): ExportColumn => ({ header, kind, pdf })

function buildTable(dataset: Dataset, assets: Asset[]): ExportTable {
  const inflationRate = loadSettings().inflationRate
  const generated = `Generated ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })} · ${assets.length} asset${assets.length === 1 ? '' : 's'}`

  if (dataset === 'register') {
    // Expiry Year (Year Installed + Asset Service Life) follows the service life column.
    const at = ASSET_COLUMNS.findIndex((c) => c.key === 'serviceLifeYears') + 1
    const columns = ASSET_COLUMNS.map((c) => col(c.label, KIND[c.type], !REGISTER_PDF_SKIP.has(c.key)))
    columns.splice(at, 0, col('Expiry Year', 'year'))
    return {
      title: 'Asset Register',
      subtitle: [generated],
      columns,
      rows: assets.map((a) => {
        // ASSET_COLUMNS only lists text and number fields.
        const row: Cell[] = ASSET_COLUMNS.map((c) => a[c.key] as Cell)
        row.splice(at, 0, expiryYear(a))
        return row
      }),
    }
  }
  const rows = assets
    .map((a) => ({ a, r: replacement(a), plan: replacementPlan(a, PLAN_YEARS, loadSettings().inflationRate), est: estimatedReplacementCost(a, loadSettings().inflationRate) }))
    // Assets without a replacement year go last.
    .sort((x, y) => (x.r.replacementYear ?? Infinity) - (y.r.replacementYear ?? Infinity))
    .map(({ a, r, plan, est }) => [
      a.structureLocation, a.refinedLocation, a.majorProject, a.roomArea, a.owner, a.assetId, a.registerNumber, a.assetName, effectiveStatus(a),
      a.quantity, a.unitOfMeasure, a.ledgerId, a.yearInstalled, a.serviceLifeYears, a.serviceLifeAuto ? 'Yes' : '', r.replacementYear, r.remainingLife,
      a.unitReplacementCost, plan.aggregate, est ? Math.round(est.amount * 100) / 100 : null, est?.year ?? null,
      ...PLAN_YEARS.map((y) => { const v = plan.byYear.get(y); return v == null ? null : Math.round(v * 100) / 100 }),
    ])

  // Spending by year for the summary sheet / page.
  const byYear = new Map(PLAN_YEARS.map((y) => [y, { count: 0, cost: 0 }]))
  for (const a of assets) {
    for (const y of replacementYears(a).years) { const b = byYear.get(y); if (b) b.count++ }
    for (const [y, v] of replacementPlan(a, PLAN_YEARS, inflationRate).byYear) { const b = byYear.get(y); if (b) b.cost += v }
  }
  const cents = (n: number) => Math.round(n * 100) / 100
  const totals = [...byYear.values()].reduce((t, b) => ({ count: t.count + b.count, cost: t.cost + b.cost }), { count: 0, cost: 0 })

  return {
    title: 'Replacement Schedule',
    subtitle: [generated, `Costs include ${inflationRate}% yearly inflation, ${PLAN_YEARS[0]}–${PLAN_YEARS[PLAN_YEARS.length - 1]}. Soonest replacement first.`],
    columns: [
      col('Structure Location Name'), col('Refined Location', 'text', false), col('Project Number', 'text', false), col('Room/Area Name', 'text', false), col('Owner', 'text', false),
      col('Asset ID'), col('Register Number', 'text', false), col('Asset Name'), col('Status'),
      col('Quantity', 'number'), col('Unit of Measurement', 'text', false), col('Ledger Number', 'text', false), col('Year Installed', 'year'), col('Asset Service Life (Years)', 'number'),
      col('Useful Life Estimated', 'text', false), col('Replacement Year', 'year'), col('Remaining Life (Years)', 'number'),
      col('Unit Replacement Cost', 'money', false), col('Aggregate (Today)', 'money'), col(`Estimated Replacement Cost (${inflationRate}% inflation)`, 'money'), col('Estimate Year', 'year'),
      ...PLAN_YEARS.map((y) => col(String(y), 'money', false)),
    ],
    rows,
    summary: {
      title: 'Spending by Year',
      columns: [col('Year', 'year'), col('Assets Due', 'number'), col(`Cost with ${inflationRate}% Inflation`, 'money')],
      rows: [...[...byYear].map(([y, b]) => [y, b.count, cents(b.cost)]), ['Total', totals.count, cents(totals.cost)]],
    },
  }
}

export default function Export() {
  const [dataset, setDataset] = useState<Dataset>('register')
  const [format, setFormat] = useState<Format>('xlsx')
  const [assets] = useState(loadAssets)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formatInfo = FORMATS.find((f) => f.value === format)!

  const onExport = async () => {
    const table = buildTable(dataset, assets)
    const stamp = new Date().toISOString().slice(0, 10)
    const base = `${dataset === 'register' ? 'asset-register' : 'replacement-schedule'}-${stamp}`
    setBusy(true)
    setError('')
    try {
      if (format === 'xlsx') await exportExcel(table, `${base}.xlsx`)
      else await exportPdf(table, `${base}.pdf`)
    } catch {
      setError('The file couldn’t be created. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Export" description="Download your data to use in Excel, accounting software or for backup." />
      <div className="card form-card">
        <fieldset className="choice-group">
          <legend>What to export</legend>
          {DATASETS.map((d) => (
            <label key={d.value} className={`choice${dataset === d.value ? ' is-selected' : ''}`}>
              <input type="radio" name="dataset" value={d.value} checked={dataset === d.value} onChange={() => setDataset(d.value)} />
              <span>
                <span className="choice-title">{d.label}</span>
                <span className="choice-text">{d.text}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="choice-group">
          <legend>Format</legend>
          <div className="segmented">
            {FORMATS.map(({ value, label, icon: Icon }) => (
              <label key={value} className={`with-icon${format === value ? ' is-selected' : ''}`}>
                <input type="radio" name="format" value={value} checked={format === value} onChange={() => setFormat(value)} />
                <Icon size={16} /> {label}
              </label>
            ))}
          </div>
          <p className="muted format-hint">{formatInfo.hint}</p>
        </fieldset>

        <div className="form-footer">
          <span className="muted">
            {assets.length === 0
              ? 'No assets yet. The file will contain column headers only.'
              : `${assets.length} asset${assets.length === 1 ? '' : 's'} will be exported.`}
            {error && <span className="text-error"> {error}</span>}
          </span>
          <button className="button primary with-icon" onClick={onExport} disabled={busy}>
            <Download size={16} /> {busy ? 'Preparing…' : `Export ${formatInfo.label}`}
          </button>
        </div>
      </div>
    </>
  )
}
