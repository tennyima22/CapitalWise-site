import { expiryYear, type Asset } from '../data/assets'

interface ExpiryYearSelectProps {
  /** The assets the list is built from (each year shows how many of them expire then). */
  assets: Asset[]
  /** '' for all years, 'none' for assets without an expiry year, or a year such as '2028'. */
  value: string
  onChange: (value: string) => void
  className?: string
}

const CURRENT_YEAR = new Date().getFullYear()

/** Dropdown of the expiry years (Year Installed + Asset Service Life) found in `assets`. */
export default function ExpiryYearSelect({ assets, value, onChange, className }: ExpiryYearSelectProps) {
  const counts = new Map<number, number>()
  let none = 0
  for (const a of assets) {
    const y = expiryYear(a)
    if (y == null) none++
    else counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  const years = [...counts.keys()].sort((a, b) => a - b)

  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Expiry year">
      <option value="">All expiry years</option>
      {years.map((y) => (
        <option key={y} value={String(y)}>
          {y}{y < CURRENT_YEAR ? ' (expired)' : ''} ({counts.get(y)})
        </option>
      ))}
      {none > 0 && <option value="none">No expiry year ({none})</option>}
    </select>
  )
}
