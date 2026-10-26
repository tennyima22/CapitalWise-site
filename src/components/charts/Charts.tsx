import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Table2, BarChart3 } from 'lucide-react'

import { SERIES_COLOR, STATUS } from './colors'

/* ---------- Layout helpers ---------- */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** A clean axis maximum and tick step for values up to `max` (e.g. 87,000 -> 100,000 in steps of 25,000). */
function niceScale(max: number, tickCount = 4) {
  if (max <= 0) return { max: 1, step: 1 }
  const raw = max / tickCount
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!
  return { max: Math.ceil(max / step) * step, step }
}

interface TooltipState {
  x: number
  y: number
  value: string
  label: string
}

function Tooltip({ tip }: { tip: TooltipState | null }) {
  if (!tip) return null
  return (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  )
}

/* ---------- Card with chart / table toggle ---------- */

export interface TableData {
  headers: string[]
  rows: (string | number)[][]
}

interface ChartCardProps {
  title: string
  subtitle?: ReactNode
  table: TableData
  children: ReactNode
  className?: string
}

export function ChartCard({ title, subtitle, table, children, className = '' }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false)
  return (
    <section className={`card chart-card ${className}`}>
      <header className="chart-card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={() => setShowTable((s) => !s)} aria-label={showTable ? 'Show chart' : 'Show as table'} title={showTable ? 'Show chart' : 'Show as table'}>
          {showTable ? <BarChart3 size={16} /> : <Table2 size={16} />}
        </button>
      </header>
      {showTable ? (
        <div className="table-wrap chart-table">
          <table className="table">
            <thead>
              <tr>{table.headers.map((h, i) => <th key={h} className={i > 0 ? 'num' : ''}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className={j > 0 ? 'num' : ''}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  )
}

/* ---------- Column chart (single series) ---------- */

export interface Datum {
  label: string
  value: number
  /** Extra line shown in the tooltip. */
  note?: string
}

interface ColumnChartProps {
  data: Datum[]
  format: (n: number) => string
  formatAxis: (n: number) => string
  ariaLabel: string
  height?: number
}

const PLOT_TOP = 22
const X_BAND = 26
const Y_GUTTER = 52

export function ColumnChart({ data, format, formatAxis, ariaLabel, height = 220 }: ColumnChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TooltipState | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  const peak = Math.max(0, ...data.map((d) => d.value))
  const { max, step } = niceScale(peak)
  const plotW = Math.max(0, width - Y_GUTTER - 4)
  const plotH = height
  const band = data.length ? plotW / data.length : 0
  const barW = Math.min(44, band * 0.7)
  const y = (v: number) => PLOT_TOP + plotH - (v / max) * plotH
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const labelEvery = Math.max(1, Math.ceil(34 / Math.max(band, 1)))
  const peakIndex = peak > 0 ? data.findIndex((d) => d.value === peak) : -1

  const show = (i: number, clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const d = data[i]
    setHover(i)
    setTip({ x: Math.min(Math.max(clientX - rect.left, 70), width - 70), y: y(d.value) - 8, value: format(d.value), label: d.note ? `${d.label} · ${d.note}` : d.label })
  }

  const columnPath = (x: number, top: number, w: number, base: number) => {
    const r = Math.min(4, base - top, w / 2)
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`
  }

  return (
    <div ref={ref} className="chart" onPointerLeave={() => { setTip(null); setHover(null) }}>
      {width > 0 && (
        <svg width={width} height={PLOT_TOP + plotH + X_BAND} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={Y_GUTTER} x2={width} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} />
              <text x={Y_GUTTER - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">{formatAxis(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = Y_GUTTER + band * i + band / 2
            const top = y(d.value)
            const base = y(0)
            return (
              <g key={d.label}>
                {d.value > 0 && (
                  <path d={columnPath(cx - barW / 2, top, barW, base)} fill={SERIES_COLOR} opacity={hover === null || hover === i ? 1 : 0.55} />
                )}
                {i === peakIndex && (
                  <text x={cx} y={top - 6} textAnchor="middle" className="chart-value">{formatAxis(d.value)}</text>
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={base + 17} textAnchor="middle" className="chart-axis">{d.label}</text>
                )}
                <rect
                  x={Y_GUTTER + band * i}
                  y={PLOT_TOP}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label}: ${format(d.value)}`}
                  onPointerMove={(e) => show(i, e.clientX)}
                  onFocus={() => show(i, ref.current!.getBoundingClientRect().left + cx)}
                  onBlur={() => { setTip(null); setHover(null) }}
                  className="chart-hit"
                />
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

/* ---------- Horizontal bar list (single series) ---------- */

interface BarListProps {
  data: (Datum & { href?: string })[]
  format: (n: number) => string
}

export function BarList({ data, format }: BarListProps) {
  const max = Math.max(0, ...data.map((d) => d.value))
  return (
    <ul className="bar-list">
      {data.map((d) => {
        const content = (
          <>
            <span className="bar-list-label" title={d.label}>{d.label}</span>
            <span className="bar-list-track">
              <span className="bar-list-area">
                <span className="bar-list-bar" style={{ width: `${max ? (d.value / max) * 100 : 0}%`, background: SERIES_COLOR }} />
              </span>
              <span className="bar-list-value">{format(d.value)}</span>
            </span>
          </>
        )
        return (
          <li key={d.label}>
            {d.href ? (
              <Link to={d.href} className="bar-list-row" aria-label={`${d.label}: ${format(d.value)}`} title={d.note}>{content}</Link>
            ) : (
              <div className="bar-list-row" title={d.note}>{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- 100% stacked bar with legend (part-to-whole) ---------- */

export interface Segment {
  label: string
  value: number
  color: string
  description?: string
}

export function StackedBar({ segments, format }: { segments: Segment[]; format: (n: number) => string }) {
  const [ref] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TooltipState | null>(null)
  const total = segments.reduce((s, x) => s + x.value, 0)
  const visible = segments.filter((s) => s.value > 0)
  const pct = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : '0%')

  const show = (s: Segment, clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    setTip({ x: Math.min(Math.max(clientX - rect.left, 70), rect.width - 70), y: -6, value: `${format(s.value)} (${pct(s.value)})`, label: s.label })
  }

  return (
    <div>
      <div ref={ref} className="stacked" onPointerLeave={() => setTip(null)}>
        <div className="stacked-bar" role="img" aria-label={segments.map((s) => `${s.label}: ${format(s.value)}`).join(', ')}>
          {visible.map((s, i) => (
            <span
              key={s.label}
              className="stacked-segment"
              style={{ flexGrow: s.value, background: s.color, borderRadius: i === visible.length - 1 ? '0 4px 4px 0' : 0 }}
              onPointerMove={(e) => show(s, e.clientX)}
            />
          ))}
        </div>
        <Tooltip tip={tip} />
      </div>
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="legend-swatch" style={{ background: s.color }} />
            <span className="legend-label">
              {s.label}
              {s.description && <span className="muted"> · {s.description}</span>}
            </span>
            <span className="legend-value">{format(s.value)}</span>
            <span className="legend-pct muted">{pct(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Donut with legend (part-to-whole, few parts) ---------- */

const DONUT_SIZE = 156
const DONUT_STROKE = 18

export function Donut({ segments, format, centerValue, centerLabel }: { segments: Segment[]; format: (n: number) => string; centerValue: string; centerLabel: string }) {
  const [tip, setTip] = useState<string | null>(null)
  const total = segments.reduce((s, x) => s + x.value, 0)
  const pct = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : '0%')
  const r = (DONUT_SIZE - DONUT_STROKE) / 2
  const circumference = 2 * Math.PI * r
  const visible = segments.filter((s) => s.value > 0)
  // A 2px surface gap between arcs, unless one arc fills the ring.
  const gap = visible.length > 1 ? 2 : 0
  const lengths = visible.map((s) => (s.value / total) * circumference)
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0))

  return (
    <div className="donut-layout">
      <div className="donut" onPointerLeave={() => setTip(null)}>
        <svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} role="img" aria-label={segments.map((s) => `${s.label}: ${format(s.value)}`).join(', ')}>
          <circle cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={DONUT_STROKE} />
          {visible.map((s, i) => (
              <circle
                key={s.label}
                cx={DONUT_SIZE / 2}
                cy={DONUT_SIZE / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={DONUT_STROKE}
                strokeDasharray={`${Math.max(lengths[i] - gap, 0.5)} ${circumference}`}
                strokeDashoffset={-starts[i]}
                transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}
                onPointerMove={() => setTip(`${s.label}: ${format(s.value)} (${pct(s.value)})`)}
              />
          ))}
        </svg>
        <div className="donut-center">
          {!tip && <strong>{centerValue}</strong>}
          <span>{tip ?? centerLabel}</span>
        </div>
      </div>
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="legend-swatch" style={{ background: s.color }} />
            <span className="legend-label">
              {s.label}
              {s.description && <span className="muted"> · {s.description}</span>}
            </span>
            <span className="legend-value">{format(s.value)}</span>
            <span className="legend-pct muted">{pct(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Meter ---------- */

export function Meter({ label, value, total, detail }: { label: string; value: number; total: number; detail?: ReactNode }) {
  const ratio = total ? value / total : 0
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="meter-value">{Math.round(ratio * 100)}%</span>
      </div>
      <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={label}>
        <span className="meter-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      {detail && <div className="meter-detail muted">{detail}</div>}
    </div>
  )
}

/* ---------- Line chart with a zero line (values can go negative) ---------- */

interface LinePoint {
  label: string
  value: number
  /** Rows for the tooltip readout, e.g. [["Opening", "$1.2M"], …]. */
  details: [string, string][]
}

interface LineChartProps {
  data: LinePoint[]
  formatAxis: (n: number) => string
  formatValue: (n: number) => string
  ariaLabel: string
  height?: number
}

/** A clean scale covering both negative and positive values, always including zero. */
function niceRange(min: number, max: number, tickCount = 4) {
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  if (hi === lo) return { lo: 0, hi: 1, step: 1 }
  const raw = (hi - lo) / tickCount
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step }
}

export function LineChart({ data, formatAxis, formatValue, ariaLabel, height = 220 }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const { lo, hi, step } = niceRange(Math.min(...data.map((d) => d.value)), Math.max(...data.map((d) => d.value)))
  const left = Y_GUTTER
  const right = 16
  const plotW = Math.max(0, width - left - right)
  const x = (i: number) => left + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2)
  const y = (v: number) => PLOT_TOP + height - ((v - lo) / (hi - lo)) * height
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step)
  const labelEvery = Math.max(1, Math.ceil(34 / Math.max(plotW / Math.max(1, data.length - 1), 1)))
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join('')
  const last = data.length - 1

  const nearest = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const rel = clientX - rect.left - left
    return Math.min(last, Math.max(0, Math.round((rel / Math.max(plotW, 1)) * last)))
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(last, (a ?? -1) + 1))
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? last + 1) - 1))
    else return
    e.preventDefault()
  }

  const tip = active == null ? null : data[active]

  return (
    <div
      ref={ref}
      className="chart"
      tabIndex={0}
      aria-label={`${ariaLabel}. Use the left and right arrow keys to read each year.`}
      onPointerMove={(e) => setActive(nearest(e.clientX))}
      onPointerLeave={() => setActive(null)}
      onFocus={() => setActive((a) => a ?? 0)}
      onBlur={() => setActive(null)}
      onKeyDown={onKey}
    >
      {width > 0 && (
        <svg width={width} height={PLOT_TOP + height + X_BAND} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline chart-zero' : 'chart-grid'} />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">{formatAxis(t)}</text>
            </g>
          ))}
          {data.map((d, i) => i % labelEvery === 0 && (
            <text key={d.label} x={x(i)} y={PLOT_TOP + height + 17} textAnchor="middle" className="chart-axis">{d.label}</text>
          ))}
          {active != null && <line x1={x(active)} x2={x(active)} y1={PLOT_TOP} y2={PLOT_TOP + height} className="chart-crosshair" />}
          <path d={path} fill="none" stroke={SERIES_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (d.value < 0 || i === last || i === active) && (
            <circle key={d.label} cx={x(i)} cy={y(d.value)} r={4} fill={d.value < 0 ? STATUS.critical : SERIES_COLOR} stroke="var(--surface)" strokeWidth={2} />
          ))}
          <text x={x(last)} y={y(data[last].value) + (data[last].value < 0 ? 18 : -10)} textAnchor="end" className="chart-value">
            {formatAxis(data[last].value)}
          </text>
        </svg>
      )}
      {tip && (
        <div className="chart-tooltip chart-tooltip-rows" style={{ left: Math.min(Math.max(x(active!), 110), width - 110), top: PLOT_TOP }}>
          <strong>{formatValue(tip.value)}</strong>
          <span>Closing balance {tip.label}</span>
          <dl>
            {tip.details.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
