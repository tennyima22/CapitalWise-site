import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Filter, Search } from 'lucide-react'

export interface FilterOption {
  /** Value compared when filtering; '' means blank. */
  key: string
  label: string
  count: number
}

interface ColumnFilterProps {
  label: string
  /** Values available in this column, given the other active filters. Called when the list opens. */
  getOptions: () => FilterOption[]
  /** Keys currently shown, or undefined when the column isn't filtered. */
  selected: Set<string> | undefined
  onChange: (next: Set<string> | undefined) => void
}

const POPOVER_WIDTH = 280

/** Excel-style column filter: a header button that opens a searchable checklist of the column's values. */
export default function ColumnFilter({ label, getOptions, selected, onChange }: ColumnFilterProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<FilterOption[]>([])
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const active = selected !== undefined

  const toggleOpen = () => {
    if (open) return setOpen(false)
    const rect = buttonRef.current!.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - POPOVER_WIDTH - 8)) })
    setOptions(getOptions())
    setSearch('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const allKeys = options.map((o) => o.key)
  const isChecked = (key: string) => !selected || selected.has(key)
  const q = search.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  // Store the selection as "everything" (undefined) when every value is ticked.
  const commit = (next: Set<string>) => onChange(allKeys.every((k) => next.has(k)) ? undefined : next)

  const toggle = (key: string) => {
    const next = new Set(selected ?? allKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    commit(next)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`col-filter-btn${active ? ' is-active' : ''}`}
        onClick={toggleOpen}
        aria-label={`Filter ${label}${active ? ' (filtered)' : ''}`}
        aria-expanded={open}
        title={active ? `Filtered: ${selected!.size} value${selected!.size === 1 ? '' : 's'}` : `Filter ${label}`}
      >
        <Filter size={12} strokeWidth={2.25} fill={active ? 'currentColor' : 'none'} />
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="col-filter-pop" style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }} role="dialog" aria-label={`Filter ${label}`}>
            <div className="col-filter-title">{label}</div>
            <label className="col-filter-search">
              <Search size={14} />
              <input autoFocus placeholder="Search values" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <div className="col-filter-actions">
              {q ? (
                <button type="button" className="link-button" onClick={() => commit(new Set(shown.map((o) => o.key)))}>Only these ({shown.length})</button>
              ) : (
                <button type="button" className="link-button" onClick={() => onChange(undefined)}>Select all</button>
              )}
              <button type="button" className="link-button" onClick={() => onChange(new Set())}>Clear all</button>
            </div>
            <ul className="col-filter-list">
              {shown.map((o) => (
                <li key={o.key}>
                  <label>
                    <input type="checkbox" checked={isChecked(o.key)} onChange={() => toggle(o.key)} />
                    <span className={`col-filter-value${o.key === '' ? ' muted' : ''}`}>{o.label}</span>
                    <span className="col-filter-count">{o.count}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="muted col-filter-none">No matching values</li>}
            </ul>
            {active && (
              <button type="button" className="button col-filter-reset" onClick={() => { onChange(undefined); setOpen(false) }}>
                Clear filter on {label}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
