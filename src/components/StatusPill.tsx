import { Ban, CheckCircle2, CircleSlash, Clock, Flag, Hourglass, type LucideIcon } from 'lucide-react'
import { effectiveStatus, isAutoFlagged, replacement, type Asset, type AssetStatus } from '../data/assets'

const STYLE: Record<AssetStatus, { className: string; icon: LucideIcon; title?: string }> = {
  'Pending Approval': { className: 'status-approval', icon: Clock, title: 'New asset waiting for approval; not yet in the capital plan' },
  Active: { className: 'status-active', icon: CheckCircle2 },
  Overdue: { className: 'status-flagged', icon: Flag, title: 'Overdue for replacement' },
  'Pending Disposal': { className: 'status-pending', icon: Hourglass, title: 'Disposal requested: waiting for approval' },
  Disposed: { className: 'status-disposed', icon: CircleSlash, title: 'Disposed: left out of the capital plan; historical figures locked' },
  Cancelled: { className: 'status-cancelled', icon: Ban, title: 'Cancelled: entered in error, kept for the audit trail' },
}

/** Why an asset is flagged, for hover text. */
function flagReason(asset: Asset) {
  if (!isAutoFlagged(asset)) return STYLE.Overdue.title
  return `Overdue automatically: past service life (due ${replacement(asset).replacementYear})`
}

/** A flag shown beside the name of an asset that is overdue (marked so, or past its service life). */
export function FlagMark({ asset }: { asset: Asset }) {
  if (effectiveStatus(asset) !== 'Overdue') return null
  const reason = flagReason(asset)
  return (
    <span className="flag-mark" title={reason} aria-label={reason}>
      <Flag size={13} strokeWidth={2.5} color="#d03b3b" fill="#d03b3b" />
    </span>
  )
}

/** Asset status as an icon + text label (never color alone). Overdue Active assets show as flagged. */
export default function StatusPill({ asset }: { asset: Asset }) {
  const status = effectiveStatus(asset)
  const { className, icon: Icon, title } = STYLE[status] ?? STYLE.Active
  return (
    <span className={`status-pill ${className}`} title={status === 'Overdue' ? flagReason(asset) : title}>
      <Icon size={12} strokeWidth={2.25} />
      {status}
      {isAutoFlagged(asset) && <span className="status-auto">auto</span>}
    </span>
  )
}
