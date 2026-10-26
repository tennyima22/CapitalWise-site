import { expiryYear, saveAssets, type Asset, type AssetStatus } from './assets'
import { appendAudit, diffAssets, entry, type Actor, type AuditEntry } from './audit'
import { createRegisterNumberer } from './registerNumber'

/** Roles, lowest to highest. Staff can flag assets and request disposal; the others can approve. */
export const ROLES = ['Staff', 'Asset Manager', 'Finance Controller', 'Admin'] as const
export type Role = (typeof ROLES)[number]

/** Maker-checker: only these roles can approve a disposal or cancel a record. */
export const canApprove = (role: string) => role === 'Asset Manager' || role === 'Finance Controller' || role === 'Admin'
export const isAdministrator = (role: string) => role === 'Admin'

export const DISPOSAL_REASONS = ['Scrapped', 'Sold at Auction', 'Trade-In', 'Lost/Stolen', 'Damaged', 'Replaced'] as const

/** Significant gap between replacement cost and original cost that deserves a second look. */
export const VARIANCE_THRESHOLD = 0.5

/**
 * How far a replacement cost is from the original purchase cost, as a fraction (0.8 = 80% higher),
 * or null when either is missing.
 */
export function costVariance(replacementCost: number | null, originalCost: number | null) {
  if (replacementCost == null || originalCost == null || originalCost <= 0) return null
  return (replacementCost - originalCost) / originalCost
}

type LogEntry = Omit<AuditEntry, 'id' | 'at'>

/** Save the register and the log entries together, so every change is recorded. */
export function commit(next: Asset[], entries: LogEntry[]) {
  saveAssets(next)
  appendAudit(entries)
  return next
}

const replaceOne = (assets: Asset[], updated: Asset) => assets.map((a) => (a.assetId === updated.assetId ? updated : a))
const statusChange = (from: AssetStatus, to: AssetStatus) => ({ field: 'Status', from, to })

/**
 * Maker step for a new asset: it is saved as Pending Approval (kept out of the plan) until an
 * approver other than the person who added it approves it.
 */
export function submitNewAsset(assets: Asset[], asset: Asset, actor: Actor) {
  const pendingAsset: Asset = {
    ...asset,
    status: 'Pending Approval',
    addition: { requestedBy: actor.name, requestedByEmail: actor.email, requestedAt: new Date().toISOString() },
  }
  return commit([...assets, pendingAsset], [entry(actor, pendingAsset, 'Addition requested', diffAssets(undefined, pendingAsset))])
}

/** Why `actor` can't approve this new asset, or null if they can. */
export function additionBlock(asset: Asset, actor: Actor): string | null {
  if (!canApprove(actor.role)) return 'Only an Asset Manager, Finance Controller or Admin can approve new assets.'
  if (asset.addition?.requestedByEmail === actor.email) return 'You added this asset, so another approver must approve it.'
  return null
}

/** Checker step: approve a new asset so it becomes Active and joins the plan. */
export function approveAddition(assets: Asset[], asset: Asset, actor: Actor, note: string) {
  const updated: Asset = { ...asset, status: 'Active', addition: asset.addition && { ...asset.addition, approvedBy: actor.name, approvedAt: new Date().toISOString() } }
  return commit(replaceOne(assets, updated), [entry(actor, asset, 'Addition approved', [statusChange('Pending Approval', 'Active')], note || undefined)])
}

/** Checker step: reject a new asset. It is kept as Cancelled (with the reason) for the audit trail. */
export function rejectAddition(assets: Asset[], asset: Asset, actor: Actor, reason: string) {
  const updated: Asset = { ...asset, status: 'Cancelled', cancelReason: `Addition rejected: ${reason}` }
  return commit(replaceOne(assets, updated), [entry(actor, asset, 'Addition rejected', [statusChange('Pending Approval', 'Cancelled')], reason)])
}

/** Flag an asset as Overdue by hand (assets past their service life are flagged automatically). */
export function markOverdue(assets: Asset[], asset: Asset, actor: Actor, note: string) {
  const updated = { ...asset, status: 'Overdue' as const }
  return commit(replaceOne(assets, updated), [entry(actor, asset, 'Marked overdue', [statusChange(asset.status, 'Overdue')], note || undefined)])
}

/** Clear a manual Overdue flag. */
export function markActive(assets: Asset[], asset: Asset, actor: Actor, note: string) {
  const updated = { ...asset, status: 'Active' as const }
  return commit(replaceOne(assets, updated), [entry(actor, asset, 'Marked active', [statusChange(asset.status, 'Active')], note || undefined)])
}

export interface DisposalInput {
  date: string
  reason: string
  reference: string
  price: number | null
}

/** Maker step: request disposal. The asset waits as Pending Disposal until an approver decides. */
export function requestDisposal(assets: Asset[], asset: Asset, input: DisposalInput, actor: Actor) {
  const updated: Asset = {
    ...asset,
    status: 'Pending Disposal',
    disposal: { ...input, requestedBy: actor.name, requestedByEmail: actor.email, requestedAt: new Date().toISOString(), previousStatus: asset.status },
  }
  return commit(replaceOne(assets, updated), [
    entry(actor, asset, 'Disposal requested', [
      statusChange(asset.status, 'Pending Disposal'),
      { field: 'Disposal Date', from: '—', to: input.date },
      { field: 'Disposal Reason', from: '—', to: input.reason },
      { field: 'Disposal Price', from: '—', to: input.price == null ? '—' : String(input.price) },
      ...(input.reference ? [{ field: 'Disposal Reference', from: '—', to: input.reference }] : []),
    ]),
  ])
}

/** Why `actor` can't approve this request, or null if they can. */
export function approvalBlock(asset: Asset, actor: Actor): string | null {
  if (!canApprove(actor.role)) return 'Only an Asset Manager, Finance Controller or Admin can approve disposals.'
  if (asset.disposal?.requestedByEmail === actor.email) return 'You requested this disposal, so another approver must approve it.'
  return null
}

/** Checker step: approve a pending disposal. */
export function approveDisposal(assets: Asset[], asset: Asset, actor: Actor, note: string) {
  const updated: Asset = { ...asset, status: 'Disposed', disposal: asset.disposal && { ...asset.disposal, approvedBy: actor.name, approvedAt: new Date().toISOString() } }
  return commit(replaceOne(assets, updated), [entry(actor, asset, 'Disposal approved', [statusChange('Pending Disposal', 'Disposed')], note || undefined)])
}

/** Checker step: reject a pending disposal; the asset returns to its earlier status. */
export function rejectDisposal(assets: Asset[], asset: Asset, actor: Actor, note: string) {
  const back = asset.disposal?.previousStatus ?? 'Active'
  const updated: Asset = { ...asset, status: back, disposal: undefined }
  return commit(replaceOne(assets, updated), [entry(actor, asset, 'Disposal rejected', [statusChange('Pending Disposal', back)], note || undefined)])
}

/** Mark a record entered in error as Cancelled (approvers only). It stays in the register for the audit trail. */
export function cancelRecord(assets: Asset[], asset: Asset, reason: string, actor: Actor) {
  const updated: Asset = { ...asset, status: 'Cancelled', cancelReason: reason }
  return commit(replaceOne(assets, updated), [entry(actor, asset, 'Cancelled', [statusChange(asset.status, 'Cancelled')], reason)])
}

/** Bring a cancelled record back as Active (approvers only). */
export function restoreRecord(assets: Asset[], asset: Asset, actor: Actor, note: string) {
  const updated: Asset = { ...asset, status: 'Active', cancelReason: undefined }
  return commit(replaceOne(assets, updated), [entry(actor, asset, 'Restored', [statusChange('Cancelled', 'Active')], note || undefined)])
}

export interface ReplacementInput {
  newAssetId: string
  quantity: number | null
  yearInstalled: number
  purchaseCost: number | null
  serviceLifeYears: number | null
  disposalDate: string
  reference: string
}

/** A free Asset ID for a successor: AST-101 -> AST-101-R, then AST-101-R2, AST-101-R3… */
export function suggestReplacementId(asset: Asset, assets: Asset[]) {
  const taken = new Set(assets.map((a) => a.assetId.toLowerCase()))
  const base = `${asset.assetId}-R`
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`.toLowerCase())) return `${base}${n}`
}

/**
 * Successor / linked-asset replacement: the old asset is sent for disposal (reason "Replaced"),
 * and a new record is created that points back to it. The old record and its history are kept.
 */
export function replaceAsset(assets: Asset[], old: Asset, input: ReplacementInput, actor: Actor) {
  const successor: Asset = {
    ...old,
    assetId: input.newAssetId,
    registerNumber: '',
    quantity: input.quantity,
    yearInstalled: input.yearInstalled,
    serviceLifeYears: input.serviceLifeYears,
    serviceLifeAuto: false,
    purchaseCost: input.purchaseCost,
    invoiceNumber: '',
    // The successor is a new asset, so it also waits for approval before joining the plan.
    status: 'Pending Approval',
    addition: { requestedBy: actor.name, requestedByEmail: actor.email, requestedAt: new Date().toISOString() },
    disposal: undefined,
    cancelReason: undefined,
    replacedByAssetId: undefined,
    replacesAssetId: old.assetId,
  }
  successor.registerNumber = createRegisterNumberer(assets).next(successor) ?? ''

  const retiring: Asset = {
    ...old,
    status: 'Pending Disposal',
    replacedByAssetId: successor.assetId,
    disposal: {
      date: input.disposalDate,
      reason: 'Replaced',
      reference: input.reference || `Replaced by ${successor.assetId}`,
      requestedBy: actor.name,
      requestedByEmail: actor.email,
      requestedAt: new Date().toISOString(),
      previousStatus: old.status,
    },
  }

  const next = [...replaceOne(assets, retiring), successor]
  return commit(next, [
    entry(actor, old, 'Replaced', [statusChange(old.status, 'Pending Disposal'), { field: 'Replaced By', from: '—', to: successor.assetId }], 'Disposal of the old asset awaits approval.'),
    entry(actor, successor, 'Created as replacement', [
      { field: 'Replaces Asset ID', from: '—', to: old.assetId },
      { field: 'Quantity', from: '—', to: input.quantity == null ? '—' : String(input.quantity) },
      { field: 'Year Installed', from: '—', to: String(input.yearInstalled) },
      { field: 'Purchase Cost', from: '—', to: input.purchaseCost == null ? '—' : String(input.purchaseCost) },
      { field: 'Expiry Year', from: '—', to: String(expiryYear(successor) ?? '—') },
    ]),
  ])
}
