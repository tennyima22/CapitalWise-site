import { useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** The glide in progress, if any; a new glide or any grab of the table/rail stops it. */
let activeGlide = 0

/** Smoothly scroll `el` horizontally to `to` over ~300ms (eased), frame by frame. */
function glide(el: HTMLElement, to: number) {
  const target = Math.max(0, Math.min(to, el.scrollWidth - el.clientWidth))
  const from = el.scrollLeft
  const start = performance.now()
  const duration = 300
  const token = ++activeGlide
  const frame = (now: number) => {
    if (token !== activeGlide) return
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    el.scrollLeft = from + (target - from) * eased
    if (t < 1) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

const stopGlide = () => {
  activeGlide++
}

interface Jump {
  label: string
  /** CSS selector (inside the scrolling area) of the header cell to bring into view. */
  selector: string
}

interface ScrollRailProps {
  /** The horizontally scrolling element (e.g. the table wrapper). */
  target: RefObject<HTMLDivElement | null>
  jumps?: Jump[]
}

/**
 * A horizontal scroll bar pinned above a wide table (so it is always reachable without scrolling
 * to the bottom), with left/right buttons and shortcuts to sections of the table. Also lets the
 * table be panned by clicking and dragging.
 */
export default function ScrollRail({ target, jumps = [] }: ScrollRailProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const [pos, setPos] = useState({ left: 0, max: 0 })
  const railDriven = useRef(false)

  // Keep the rail the same width as the table and follow its scroll position.
  useEffect(() => {
    const el = target.current
    if (!el) return
    const measure = () => {
      setContentWidth(el.scrollWidth)
      setPos({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth })
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(el)
    if (el.firstElementChild) resize.observe(el.firstElementChild)
    // Only copy positions that actually differ, so neither side interrupts the other's smooth scrolling.
    const onScroll = () => {
      setPos({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth })
      const r = railRef.current
      if (r && Math.abs(r.scrollLeft - el.scrollLeft) > 1) r.scrollLeft = el.scrollLeft
    }
    el.addEventListener('scroll', onScroll)

    // Dragging the rail scrolls the table.
    const rail = railRef.current
    const onRailScroll = () => {
      if (rail && railDriven.current && Math.abs(rail.scrollLeft - el.scrollLeft) > 1) el.scrollLeft = rail.scrollLeft
    }
    // Only the person dragging the rail should move the table from it (not the rail catching up).
    const markRail = () => {
      stopGlide()
      railDriven.current = true
    }
    const unmarkRail = () => (railDriven.current = false)
    const grabTable = () => {
      stopGlide()
      railDriven.current = false
    }
    rail?.addEventListener('pointerdown', markRail)
    rail?.addEventListener('wheel', markRail, { passive: true })
    window.addEventListener('pointerup', unmarkRail)
    el.addEventListener('pointerdown', grabTable)
    el.addEventListener('wheel', grabTable, { passive: true })
    rail?.addEventListener('scroll', onRailScroll)

    // Click-and-drag panning on the table (ignores buttons, links and form controls).
    let dragStart: { x: number; left: number } | null = null
    let moved = false
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
      dragStart = { x: e.clientX, left: el.scrollLeft }
      moved = false
    }
    const onMove = (e: MouseEvent) => {
      if (!dragStart) return
      const dx = e.clientX - dragStart.x
      if (!moved && Math.abs(dx) < 4) return
      moved = true
      el.classList.add('is-dragging')
      el.scrollLeft = dragStart.left - dx
      e.preventDefault()
    }
    const onUp = () => {
      dragStart = null
      el.classList.remove('is-dragging')
    }
    // A drag shouldn't also count as a click on the row underneath.
    const onClick = (e: MouseEvent) => {
      if (moved) {
        e.stopPropagation()
        e.preventDefault()
        moved = false
      }
    }
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    el.addEventListener('click', onClick, true)
    return () => {
      resize.disconnect()
      el.removeEventListener('scroll', onScroll)
      rail?.removeEventListener('scroll', onRailScroll)
      rail?.removeEventListener('pointerdown', markRail)
      rail?.removeEventListener('wheel', markRail)
      window.removeEventListener('pointerup', unmarkRail)
      el.removeEventListener('pointerdown', grabTable)
      el.removeEventListener('wheel', grabTable)
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      el.removeEventListener('click', onClick, true)
    }
  }, [target])

  const step = (dir: 1 | -1) => {
    railDriven.current = false
    const el = target.current
    if (el) glide(el, el.scrollLeft + dir * el.clientWidth * 0.75)
  }

  const jumpTo = (selector: string) => {
    railDriven.current = false
    const el = target.current
    const cell = el?.querySelector<HTMLElement>(selector)
    if (!el || !cell) return
    // Bring the section's first column to the left edge of the table, measured on screen.
    glide(el, el.scrollLeft + cell.getBoundingClientRect().left - el.getBoundingClientRect().left)
  }

  const percent = pos.max > 0 ? Math.round((pos.left / pos.max) * 100) : 0

  return (
    // Always rendered (so the rail can be wired up on first render); hidden while the table fits.
    <div className="scroll-rail" hidden={pos.max <= 1}>
      <button type="button" className="icon-button rail-btn" onClick={() => step(-1)} disabled={pos.left <= 0} aria-label="Scroll table left">
        <ChevronLeft size={18} />
      </button>
      <div ref={railRef} className="rail-track" aria-hidden="true">
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
      <button type="button" className="icon-button rail-btn" onClick={() => step(1)} disabled={pos.left >= pos.max - 1} aria-label="Scroll table right">
        <ChevronRight size={18} />
      </button>
      {jumps.length > 0 && (
        <div className="rail-jumps" role="group" aria-label="Jump to columns">
          {jumps.map((j) => (
            <button key={j.label} type="button" className="chip" onClick={() => jumpTo(j.selector)}>{j.label}</button>
          ))}
        </div>
      )}
      <span className="rail-hint muted" title="You can also click and drag the table, or hold Shift and use the mouse wheel.">
        {percent}% · drag table or Shift + wheel
      </span>
    </div>
  )
}
