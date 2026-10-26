import type { Asset } from './assets'
import type { Actor } from './audit'

/** A copy of an asset taken just before it was permanently removed from the register. */
export interface DeletedAsset {
  asset: Asset
  deletedAt: string
  deletedBy: string
  deletedByEmail: string
  /** How it was removed, e.g. "Delete all assets (Settings)". */
  reason: string
}

const STORAGE_KEY = 'capitalwise.deleted'

/** Permanently deleted assets, newest first. Like the activity log, there is no way to edit it. */
export function loadDeleted(): DeletedAsset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DeletedAsset[]) : []
  } catch {
    return []
  }
}

/** Keep a copy of assets that are about to be permanently removed, so they still appear in reports. */
export function archiveDeleted(assets: Asset[], actor: Actor, reason: string) {
  if (assets.length === 0) return
  const deletedAt = new Date().toISOString()
  const records = assets.map((asset) => ({ asset, deletedAt, deletedBy: actor.name, deletedByEmail: actor.email, reason }))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...records, ...loadDeleted()]))
  } catch {
    // Storage full or unavailable: the deletion still goes ahead; the audit log records it.
  }
}
