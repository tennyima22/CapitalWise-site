import { ASSET_COLUMNS, type Asset } from './assets'

export type AuditAction =
  | 'Created'
  | 'Addition requested'
  | 'Addition approved'
  | 'Addition rejected'
  | 'Edited'
  | 'Imported'
  | 'Marked overdue'
  | 'Marked active'
  | 'Disposal requested'
  | 'Disposal approved'
  | 'Disposal rejected'
  | 'Replaced'
  | 'Created as replacement'
  | 'Cancelled'
  | 'Restored'
  | 'Register cleared'
  | 'User invited'
  | 'Role changed'
  | 'User disabled'
  | 'User enabled'

export interface AuditChange {
  field: string
  from: string
  to: string
}

/** One immutable entry in the activity log: who did what to which asset, and when. */
export interface AuditEntry {
  id: string
  at: string
  userName: string
  userEmail: string
  userRole: string
  assetId: string
  assetName: string
  action: AuditAction
  changes: AuditChange[]
  note?: string
}

export interface Actor {
  name: string
  email: string
  role: string
}

const STORAGE_KEY = 'capitalwise.audit'

/** The activity log, newest first. There is deliberately no way to edit or delete entries. */
export function loadAudit(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AuditEntry[]) : []
  } catch {
    return []
  }
}

/** Append entries to the log (it is only ever added to). */
export function appendAudit(entries: Omit<AuditEntry, 'id' | 'at'>[]) {
  if (entries.length === 0) return
  const at = new Date().toISOString()
  const stamped = entries.map((e, i) => ({ ...e, at, id: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}` }))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...stamped.reverse(), ...loadAudit()]))
  } catch {
    // Storage unavailable: the log can't be kept this session.
  }
}

export const auditForAsset = (assetId: string) => loadAudit().filter((e) => e.assetId === assetId)

/** Build a log entry for `asset` by `actor`. */
export function entry(actor: Actor, asset: Pick<Asset, 'assetId' | 'assetName'>, action: AuditAction, changes: AuditChange[] = [], note?: string): Omit<AuditEntry, 'id' | 'at'> {
  return { userName: actor.name, userEmail: actor.email, userRole: actor.role, assetId: asset.assetId, assetName: asset.assetName, action, changes, note }
}

const show = (v: unknown) => (v == null || v === '' ? '—' : String(v))

/** Field-by-field differences between two versions of an asset, using the column names users see. */
export function diffAssets(before: Asset | undefined, after: Asset): AuditChange[] {
  const changes: AuditChange[] = []
  for (const col of ASSET_COLUMNS) {
    const a = before?.[col.key]
    const b = after[col.key]
    if (show(a) !== show(b)) changes.push({ field: col.label, from: before ? show(a) : '—', to: show(b) })
  }
  return changes
}
