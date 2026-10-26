import { useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Ban, CheckCircle2, Copy, Flag, Hourglass, Lock, RotateCcw, XCircle } from 'lucide-react'
import Modal from '../../components/Modal'
import StatusPill from '../../components/StatusPill'
import { aggregateCost, effectiveStatus, isAutoFlagged, parseServiceLife, replacement, type Asset } from '../../data/assets'
import type { Actor } from '../../data/audit'
import {
  DISPOSAL_REASONS,
  VARIANCE_THRESHOLD,
  additionBlock,
  approvalBlock,
  approveAddition,
  approveDisposal,
  canApprove,
  cancelRecord,
  costVariance,
  markActive,
  markOverdue,
  rejectAddition,
  rejectDisposal,
  replaceAsset,
  requestDisposal,
  restoreRecord,
  suggestReplacementId,
} from '../../data/lifecycle'
import { formatMoney } from '../../lib/format'

type Step = 'menu' | 'approveAdd' | 'rejectAdd' | 'overdue' | 'active' | 'dispose' | 'replace' | 'cancel' | 'approve' | 'reject' | 'restore'

interface StatusModalProps {
  asset: Asset
  /** The whole register (needed to check new Asset IDs and save changes). */
  assets: Asset[]
  actor: Actor
  onDone: (next: Asset[]) => void
  onClose: () => void
  /** Open straight at a step, e.g. "approve" from the approvals page. */
  initialStep?: Step
}

const today = () => new Date().toISOString().slice(0, 10)
const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '')

export default function StatusModal({ asset, assets, actor, onDone, onClose, initialStep = 'menu' }: StatusModalProps) {
  const [step, setStep] = useState<Step>(initialStep)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [disposal, setDisposal] = useState({ date: today(), reason: '', reference: '', price: '' })
  const todayCost = aggregateCost(asset)
  const [replacementForm, setReplacementForm] = useState(() => ({
    newAssetId: suggestReplacementId(asset, assets),
    quantity: asset.quantity == null ? '' : String(asset.quantity),
    yearInstalled: String(new Date().getFullYear()),
    serviceLife: asset.serviceLifeYears == null ? '' : String(asset.serviceLifeYears),
    purchaseCost: todayCost == null ? '' : String(Math.round(todayCost)),
    disposalDate: today(),
    reference: '',
  }))

  // Editing a field clears the previous error message.
  const updateDisposal = (patch: Partial<typeof disposal>) => { setDisposal((d) => ({ ...d, ...patch })); setError('') }
  const updateReplacement = (patch: Partial<typeof replacementForm>) => { setReplacementForm((r) => ({ ...r, ...patch })); setError('') }

  const status = effectiveStatus(asset)
  const approver = canApprove(actor.role)
  const auto = isAutoFlagged(asset)

  const finish = (next: Asset[]) => {
    onDone(next)
    onClose()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    switch (step) {
      case 'approveAdd': {
        const block = additionBlock(asset, actor)
        if (block) return setError(block)
        return finish(approveAddition(assets, asset, actor, note.trim()))
      }
      case 'rejectAdd':
        if (!canApprove(actor.role)) return setError('Only an approver can reject a new asset.')
        if (!note.trim()) return setError('Explain why the asset is rejected.')
        return finish(rejectAddition(assets, asset, actor, note.trim()))
      case 'overdue':
        return finish(markOverdue(assets, asset, actor, note.trim()))
      case 'active':
        return finish(markActive(assets, asset, actor, note.trim()))
      case 'dispose':
        if (!disposal.date) return setError('Enter the disposal date.')
        if (disposal.date > today()) return setError('The disposal date can’t be in the future.')
        if (!disposal.reason) return setError('Choose a disposal reason.')
        if (disposal.price.trim() === '') return setError('Enter the disposal price (0 if it was scrapped, lost or stolen).')
        {
          const price = Number(disposal.price.replace(/[$,\s]/g, ''))
          if (!Number.isFinite(price) || price < 0) return setError('Disposal price must be an amount of 0 or more.')
          return finish(requestDisposal(assets, asset, { date: disposal.date, reason: disposal.reason, reference: disposal.reference.trim(), price }, actor))
        }
      case 'approve': {
        const block = approvalBlock(asset, actor)
        if (block) return setError(block)
        return finish(approveDisposal(assets, asset, actor, note.trim()))
      }
      case 'reject':
        if (!canApprove(actor.role)) return setError('Only an approver can reject a disposal request.')
        return finish(rejectDisposal(assets, asset, actor, note.trim()))
      case 'cancel':
        if (!note.trim()) return setError('Explain why this record was entered in error.')
        return finish(cancelRecord(assets, asset, note.trim(), actor))
      case 'restore':
        return finish(restoreRecord(assets, asset, actor, note.trim()))
      case 'replace': {
        const id = replacementForm.newAssetId.trim()
        if (!id) return setError('Enter an Asset ID for the new asset.')
        if (assets.some((a) => a.assetId.toLowerCase() === id.toLowerCase())) return setError(`Asset ID ${id} is already used.`)
        const quantity = replacementForm.quantity.trim() ? Number(replacementForm.quantity.replace(/[,\s]/g, '')) : null
        if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return setError('Enter a Quantity greater than 0 for the new asset.')
        const year = Number(replacementForm.yearInstalled)
        if (!Number.isInteger(year) || year < 1800 || year > new Date().getFullYear() + 1) return setError('Enter a 4-digit Year Installed.')
        const life = replacementForm.serviceLife.trim() ? parseServiceLife(replacementForm.serviceLife) : null
        if (replacementForm.serviceLife.trim() && (life == null || life <= 0)) return setError('Asset Service Life must be a whole number of years, or a range like "12 to 15".')
        const cost = replacementForm.purchaseCost.trim() ? Number(replacementForm.purchaseCost.replace(/[$,\s]/g, '')) : null
        if (cost != null && (!Number.isFinite(cost) || cost < 0)) return setError('Purchase Cost must be an amount of 0 or more.')
        if (!replacementForm.disposalDate || replacementForm.disposalDate > today()) return setError('Enter the date the old asset was taken out of service (not in the future).')
        return finish(replaceAsset(assets, asset, { newAssetId: id, quantity, yearInstalled: year, serviceLifeYears: life, purchaseCost: cost, disposalDate: replacementForm.disposalDate, reference: replacementForm.reference.trim() }, actor))
      }
    }
  }

  const option = (icon: ReactNode, title: string, text: string, target: Step, opts: { disabled?: string; tone?: 'danger' | 'primary' } = {}) => (
    <button type="button" className={`lifecycle-option${opts.tone ? ` ${opts.tone}` : ''}`} onClick={() => setStep(target)} disabled={!!opts.disabled} title={opts.disabled}>
      <span className="lifecycle-icon">{icon}</span>
      <span className="lifecycle-text">
        <strong>{title}</strong>
        <span>{opts.disabled ?? text}</span>
      </span>
      <ArrowRight size={16} className="lifecycle-arrow" />
    </button>
  )

  const noteField = (label: string, required = false) => (
    <label className="field">
      <span>{label}{required && <span className="required"> *</span>}</span>
      <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
    </label>
  )

  const disposalDetails = asset.disposal && (
    <dl className="detail-list">
      <div><dt>Disposal date</dt><dd>{asset.disposal.date}</dd></div>
      <div><dt>Reason</dt><dd>{asset.disposal.reason}</dd></div>
      <div><dt>Disposal price</dt><dd>{asset.disposal.price == null ? '—' : formatMoney(asset.disposal.price)}</dd></div>
      <div><dt>Reference</dt><dd>{asset.disposal.reference || '—'}</dd></div>
      <div><dt>Requested by</dt><dd>{asset.disposal.requestedBy} · {formatDate(asset.disposal.requestedAt)}</dd></div>
      {asset.disposal.approvedBy && <div><dt>Approved by</dt><dd>{asset.disposal.approvedBy} · {formatDate(asset.disposal.approvedAt)}</dd></div>}
    </dl>
  )

  const links = (asset.replacesAssetId || asset.replacedByAssetId) && (
    <p className="muted lifecycle-links">
      {asset.replacesAssetId && <>Replaces Asset ID: <strong>{asset.replacesAssetId}</strong>. </>}
      {asset.replacedByAssetId && <>Replaced by Asset ID: <strong>{asset.replacedByAssetId}</strong>.</>}
    </p>
  )

  const newCost = replacementForm.purchaseCost.trim() ? Number(replacementForm.purchaseCost.replace(/[$,\s]/g, '')) : null
  const originalCost = asset.purchaseCost ?? todayCost
  const variance = costVariance(newCost, originalCost)

  const additionDetails = asset.addition && (
    <dl className="detail-list">
      <div><dt>Added by</dt><dd>{asset.addition.requestedBy} · {formatDate(asset.addition.requestedAt)}</dd></div>
      {asset.addition.approvedBy && <div><dt>Approved by</dt><dd>{asset.addition.approvedBy} · {formatDate(asset.addition.approvedAt)}</dd></div>}
      {asset.replacesAssetId && <div><dt>Replaces</dt><dd>{asset.replacesAssetId}</dd></div>}
    </dl>
  )

  const formSteps: Record<Exclude<Step, 'menu'>, { title: string; button: string; danger?: boolean; body: ReactNode }> = {
    approveAdd: {
      title: 'Approve new asset',
      button: 'Approve asset',
      body: (
        <>
          {additionDetails}
          <p className="muted">Approving makes the asset <strong>Active</strong> and adds it to replacement costs, schedules and the cash forecast.</p>
          {noteField('Note (optional)')}
        </>
      ),
    },
    rejectAdd: {
      title: 'Reject new asset',
      button: 'Reject asset',
      danger: true,
      body: (
        <>
          {additionDetails}
          <p className="muted">The asset is marked <strong>Cancelled</strong> with your reason. It is kept for the audit trail, not deleted.</p>
          {noteField('Reason', true)}
        </>
      ),
    },
    overdue: { title: 'Mark as overdue', button: 'Mark overdue', body: noteField('Note (optional)') },
    active: { title: 'Mark as active', button: 'Mark active', body: noteField('Note (optional)') },
    dispose: {
      title: 'Request disposal',
      button: 'Request disposal',
      body: (
        <>
          <p className="muted">The asset becomes <strong>Pending Disposal</strong> until an Asset Manager, Finance Controller or Admin approves it.</p>
          <div className="form-grid">
            <label className="field">
              <span>Disposal Date <span className="required">*</span></span>
              <input type="date" value={disposal.date} max={today()} onChange={(e) => updateDisposal({ date: e.target.value })} />
              <span className="field-hint">When it was taken out of service.</span>
            </label>
            <label className="field">
              <span>Disposal Reason <span className="required">*</span></span>
              <select value={disposal.reason} onChange={(e) => updateDisposal({ reason: e.target.value })}>
                <option value="">Choose a reason</option>
                {DISPOSAL_REASONS.filter((r) => r !== 'Replaced').map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Disposal Price <span className="required">*</span></span>
              <input inputMode="decimal" value={disposal.price} onChange={(e) => updateDisposal({ price: e.target.value })} placeholder="e.g. 1,500" />
              <span className="field-hint">Amount received (sale, auction or trade-in). Enter 0 if scrapped, lost or stolen.</span>
            </label>
            <label className="field">
              <span>Disposal Reference</span>
              <input value={disposal.reference} onChange={(e) => updateDisposal({ reference: e.target.value })} placeholder="Invoice or ticket number" />
            </label>
          </div>
        </>
      ),
    },
    replace: {
      title: `Replace ${asset.assetId}`,
      button: 'Create replacement',
      body: (
        <>
          <p className="muted">
            A new asset is created that <strong>replaces {asset.assetId}</strong>, starting a fresh service life and forecast. The old asset keeps its
            history and goes to <strong>Pending Disposal</strong> (reason “Replaced”). Both the new asset and the disposal need approval.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>New Asset ID <span className="required">*</span></span>
              <input value={replacementForm.newAssetId} onChange={(e) => updateReplacement({ newAssetId: e.target.value })} />
            </label>
            <label className="field">
              <span>Quantity <span className="required">*</span></span>
              <input inputMode="decimal" value={replacementForm.quantity} onChange={(e) => updateReplacement({ quantity: e.target.value })} />
              <span className="field-hint">{asset.quantity != null ? `Old asset: ${asset.quantity} ${asset.unitOfMeasure}`.trim() : 'Number of units being installed.'}</span>
            </label>
            <label className="field">
              <span>Year Installed <span className="required">*</span></span>
              <input inputMode="numeric" value={replacementForm.yearInstalled} onChange={(e) => updateReplacement({ yearInstalled: e.target.value })} />
            </label>
            <label className="field">
              <span>Asset Service Life</span>
              <input value={replacementForm.serviceLife} onChange={(e) => updateReplacement({ serviceLife: e.target.value })} placeholder="e.g. 15 or 12 to 15" />
            </label>
            <label className="field">
              <span>Purchase Cost (new asset)</span>
              <input inputMode="decimal" value={replacementForm.purchaseCost} onChange={(e) => updateReplacement({ purchaseCost: e.target.value })} />
              {todayCost != null && <span className="field-hint">Prefilled with today’s replacement cost estimate ({formatMoney(todayCost)}).</span>}
            </label>
            <label className="field">
              <span>Old asset taken out of service <span className="required">*</span></span>
              <input type="date" value={replacementForm.disposalDate} max={today()} onChange={(e) => updateReplacement({ disposalDate: e.target.value })} />
            </label>
            <label className="field">
              <span>Disposal Reference</span>
              <input value={replacementForm.reference} onChange={(e) => updateReplacement({ reference: e.target.value })} placeholder={`Replaced by ${replacementForm.newAssetId}`} />
            </label>
          </div>
          {variance != null && Math.abs(variance) > VARIANCE_THRESHOLD && (
            <p className="variance-warning">
              <AlertTriangle size={16} />
              <span>
                Note: the new cost is {Math.round(Math.abs(variance) * 100)}% {variance > 0 ? 'higher' : 'lower'} than the old asset’s historical cost ({formatMoney(originalCost)}). Please verify before saving.
              </span>
            </p>
          )}
        </>
      ),
    },
    cancel: {
      title: 'Cancel record (entered in error)',
      button: 'Cancel record',
      danger: true,
      body: (
        <>
          <p className="muted">The record is not deleted: it is marked <strong>Cancelled</strong>, hidden from normal views and left out of the plan, and kept with its history for audit.</p>
          {noteField('Reason', true)}
        </>
      ),
    },
    approve: {
      title: 'Approve disposal',
      button: 'Approve disposal',
      body: (
        <>
          {disposalDetails}
          <p className="muted">Approving marks the asset <strong>Disposed</strong>: it leaves the capital plan and its historical figures are locked.</p>
          {noteField('Note (optional)')}
        </>
      ),
    },
    reject: {
      title: 'Reject disposal',
      button: 'Reject request',
      danger: true,
      body: (
        <>
          {disposalDetails}
          <p className="muted">The asset returns to <strong>{asset.disposal?.previousStatus ?? 'Active'}</strong>.</p>
          {noteField('Reason (optional)')}
        </>
      ),
    },
    restore: { title: 'Restore record', button: 'Restore as Active', body: <>{asset.cancelReason && <p className="muted">Cancelled because: {asset.cancelReason}</p>}{noteField('Note (optional)')}</> },
  }

  const menu = (
    <div className="lifecycle-menu">
      <div className="lifecycle-current">
        <span className="muted">Current status</span>
        <StatusPill asset={asset} />
      </div>
      {links}

      {status === 'Pending Approval' && (
        <>
          {additionDetails}
          {option(<CheckCircle2 size={18} />, 'Approve new asset', 'Make it Active and add it to the plan.', 'approveAdd', { tone: 'primary', disabled: additionBlock(asset, actor) ?? undefined })}
          {option(<XCircle size={18} />, 'Reject new asset', 'Mark it Cancelled with a reason.', 'rejectAdd', { tone: 'danger', disabled: approver ? undefined : 'Only an approver can reject a new asset.' })}
        </>
      )}

      {(status === 'Active' || status === 'Overdue') && (
        <>
          {status === 'Active' && option(<Flag size={18} />, 'Mark as overdue', 'Flag it for replacement now.', 'overdue')}
          {status === 'Overdue' && !auto && option(<CheckCircle2 size={18} />, 'Mark as active', 'Clear the overdue flag.', 'active')}
          {status === 'Overdue' && auto && (
            <p className="muted lifecycle-auto">Overdue automatically: past its service life (expired {replacement(asset).replacementYear}). It stays overdue until it is replaced or disposed, or its install year or service life is corrected.</p>
          )}
          {option(<Copy size={18} />, 'Replace asset', 'Create a linked new asset; the old one goes for disposal.', 'replace', { tone: 'primary' })}
          {option(<Hourglass size={18} />, 'Request disposal', 'Scrapped, sold, traded in, lost or damaged — needs approval.', 'dispose')}
          {option(<Ban size={18} />, 'Cancel record', 'Entered in error. Hidden, never deleted.', 'cancel', { tone: 'danger', disabled: approver ? undefined : 'Only an approver can cancel a record.' })}
        </>
      )}

      {status === 'Pending Disposal' && (
        <>
          {disposalDetails}
          {option(<CheckCircle2 size={18} />, 'Approve disposal', 'Mark the asset Disposed.', 'approve', { tone: 'primary', disabled: approvalBlock(asset, actor) ?? undefined })}
          {option(<XCircle size={18} />, 'Reject request', `Return it to ${asset.disposal?.previousStatus ?? 'Active'}.`, 'reject', { tone: 'danger', disabled: approver ? undefined : 'Only an approver can reject a request.' })}
        </>
      )}

      {status === 'Disposed' && (
        <>
          {disposalDetails}
          <p className="lifecycle-locked"><Lock size={15} /> Disposed assets are locked. Historical figures (Year Installed, Purchase Cost, Unit Replacement, Quantity, Service Life) can’t be changed.</p>
        </>
      )}

      {status === 'Cancelled' && (
        <>
          {asset.cancelReason && <p className="muted">Cancelled because: {asset.cancelReason}</p>}
          {option(<RotateCcw size={18} />, 'Restore record', 'Bring it back as Active.', 'restore', { disabled: approver ? undefined : 'Only an approver can restore a record.' })}
        </>
      )}
    </div>
  )

  const current = step === 'menu' ? null : formSteps[step]
  return (
    <Modal
      title={current ? current.title : `Change status · ${asset.assetName}`}
      onClose={onClose}
      footer={
        current && (
          <>
            {initialStep === 'menu' && <button type="button" className="button" onClick={() => { setStep('menu'); setError('') }}>Back</button>}
            <button type="button" className="button" onClick={onClose}>Close</button>
            <button type="submit" form="status-form" className={`button ${current.danger ? 'danger' : 'primary'}`}>{current.button}</button>
          </>
        )
      }
    >
      {current ? (
        <form id="status-form" className="lifecycle-form" onSubmit={submit} noValidate>
          <p className="lifecycle-asset"><strong>{asset.assetName}</strong> <span className="muted">· {asset.assetId}</span></p>
          {current.body}
          {error && <p className="form-error">{error}</p>}
        </form>
      ) : (
        menu
      )}
    </Modal>
  )
}
