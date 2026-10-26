import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, Lock, Sparkles } from 'lucide-react'
import Modal from '../../components/Modal'
import StatusPill from '../../components/StatusPill'
import { ASSET_COLUMNS, LOCKED_WHEN_DISPOSED, isAutoFlagged, isLocked, parseField, type Asset } from '../../data/assets'
import { auditForAsset } from '../../data/audit'
import { VARIANCE_THRESHOLD, costVariance } from '../../data/lifecycle'
import { formatMoney } from '../../lib/format'
import { DEPARTMENTS, departmentsInUse, matchDepartment, resolveDepartment } from '../../data/departments'
import { buildLifeIndex } from '../../data/usefulLife'
import { createRegisterNumberer } from '../../data/registerNumber'

type FormValues = Record<keyof Asset, string>
type FormErrors = Partial<Record<keyof Asset, string>>

interface AssetFormModalProps {
  /** The asset being edited, or undefined when adding. */
  asset?: Asset
  /** Department (Structure Location Name) to pre-select when adding. */
  defaultDepartment?: string
  existingIds: Set<string>
  /** Existing owner names, offered as suggestions. */
  owners: string[]
  /** Assets in the register, used to estimate useful life from similar assets. */
  knownAssets: Asset[]
  onSave: (asset: Asset, originalId?: string) => void
  onClose: () => void
}

const FORM_ID = 'asset-form'

function toValues(asset: Asset | undefined, defaultDepartment = ''): FormValues {
  const values = {} as FormValues
  for (const col of ASSET_COLUMNS) {
    const v = asset?.[col.key]
    values[col.key] = v == null ? '' : String(v)
  }
  if (!asset) values.structureLocation = defaultDepartment
  // Show a department saved with a variant spelling (e.g. "Facility") as its canonical name.
  values.structureLocation = matchDepartment(values.structureLocation) ?? values.structureLocation
  return values
}

export default function AssetFormModal({ asset, defaultDepartment, existingIds, owners, knownAssets, onSave, onClose }: AssetFormModalProps) {
  const [values, setValues] = useState<FormValues>(() => toValues(asset, defaultDepartment))
  const [errors, setErrors] = useState<FormErrors>({})
  const [lifeAuto, setLifeAuto] = useState(asset?.serviceLifeAuto ?? false)
  const [tab, setTab] = useState<'details' | 'history'>('details')
  const history = useMemo(() => (asset ? auditForAsset(asset.assetId) : []), [asset])
  const locked = isLocked(asset)
  const isFieldLocked = (key: keyof Asset) => locked && LOCKED_WHEN_DISPOSED.includes(key)

  // Variance alert: replacement cost today (Qty × Unit Replacement) vs the original purchase cost.
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[$,\s]/g, '')))
  const qty = num(values.quantity)
  const unit = num(values.unitReplacementCost)
  const replacementToday = qty != null && unit != null && Number.isFinite(qty * unit) ? qty * unit : null
  const variance = costVariance(replacementToday, num(values.purchaseCost))

  const otherAssets = useMemo(() => knownAssets.filter((a) => a.assetId !== asset?.assetId), [knownAssets, asset])
  const knownDepartments = useMemo(() => [...new Set([...DEPARTMENTS, ...departmentsInUse(knownAssets)])], [knownAssets])
  // What the typed department will be saved as, after correcting spelling against known departments.
  const departmentResult = resolveDepartment(values.structureLocation, departmentsInUse(knownAssets))
  const lifeIndex = useMemo(() => buildLifeIndex(otherAssets), [otherAssets])
  const suggestion = lifeIndex.suggest(values.assetName)

  // Register number this asset will get if the field is left blank.
  const installYear = /^\d{4}$/.test(values.yearInstalled.trim()) ? Number(values.yearInstalled) : null
  const registerPreview = values.registerNumber.trim()
    ? null
    : createRegisterNumberer(otherAssets).peek({ structureLocation: values.structureLocation, yearInstalled: installYear })

  const set = (key: keyof Asset, value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    if (key === 'serviceLifeYears') setLifeAuto(false)
  }

  const applySuggestion = () => {
    if (!suggestion) return
    setValues((v) => ({ ...v, serviceLifeYears: String(suggestion.years) }))
    setErrors((e) => ({ ...e, serviceLifeYears: undefined }))
    setLifeAuto(true)
  }

  // Fill a blank useful life automatically once the asset name is entered.
  const onNameBlur = () => {
    if (values.serviceLifeYears.trim() === '') applySuggestion()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const nextErrors: FormErrors = {}
    const result = {} as Record<keyof Asset, string | number | boolean | null>

    for (const col of ASSET_COLUMNS) {
      const raw = values[col.key]
      const { value, error } = parseField(col, raw)
      if (col.required && raw.trim() === '') nextErrors[col.key] = `${col.label} is required`
      else if (error) nextErrors[col.key] = error
      result[col.key] = value
    }
    result.serviceLifeAuto = lifeAuto && result.serviceLifeYears != null
    const id = values.assetId.trim()
    if (id && id !== asset?.assetId && existingIds.has(id)) nextErrors.assetId = 'Another asset already uses this Asset ID'

    if (Object.keys(nextErrors).length > 0) return setErrors(nextErrors)
    // Keep lifecycle details (status, disposal, links) that the form doesn't edit; status changes go through the status pop-up.
    const saved = { ...asset, ...(result as unknown as Asset), status: asset?.status ?? 'Active' } as Asset
    if (locked) for (const key of LOCKED_WHEN_DISPOSED) (saved as unknown as Record<string, unknown>)[key] = asset![key]
    if (departmentResult) saved.structureLocation = departmentResult.name
    if (!saved.registerNumber) saved.registerNumber = createRegisterNumberer(otherAssets).next(saved) ?? ''
    onSave(saved, asset?.assetId)
  }

  const field = (key: keyof Asset, extra?: ReactNode) => {
    const col = ASSET_COLUMNS.find((c) => c.key === key)!
    const numeric = col.type === 'quantity' || col.type === 'year' || col.type === 'years' || col.type === 'money'
    return (
      <label className={`field${errors[key] ? ' has-error' : ''}`}>
        <span>
          {col.label}
          {col.required && <span className="required"> *</span>}
        </span>
        {col.type === 'department' ? (
          <input value={values[key]} onChange={(e) => set(key, e.target.value)} list="asset-departments" placeholder="Choose or type a department" />
        ) : col.type === 'status' ? (
          <span className="status-readonly">{asset ? <StatusPill asset={asset} /> : <StatusPill asset={{ status: 'Pending Approval' } as Asset} />}</span>
        ) : (
          <input
            disabled={isFieldLocked(key)}
            value={values[key]}
            onChange={(e) => set(key, e.target.value)}
            onBlur={key === 'assetName' ? onNameBlur : undefined}
            inputMode={col.type === 'money' ? 'decimal' : numeric && col.type !== 'years' ? 'numeric' : undefined}
            placeholder={col.type === 'years' ? 'e.g. 15 or 12 to 15' : key === 'registerNumber' ? (registerPreview ?? 'Assigned automatically') : undefined}
            list={key === 'owner' ? 'asset-owners' : undefined}
          />
        )}
        {errors[key] && <span className="field-error">{errors[key]}</span>}
        {isFieldLocked(key) && <span className="field-hint"><Lock size={12} /> Locked: asset is {asset!.status.toLowerCase()}</span>}
        {extra}
      </label>
    )
  }

  const lifeHint = (() => {
    if (lifeAuto && values.serviceLifeYears.trim() !== '') {
      return (
        <span className="field-hint auto">
          <Sparkles size={13} /> Estimated from the asset name{suggestion ? `. ${suggestion.reason}` : ''}. Type a value to override.
        </span>
      )
    }
    if (suggestion && String(suggestion.years) !== values.serviceLifeYears.trim()) {
      return (
        <span className="field-hint">
          <Sparkles size={13} /> Suggested {suggestion.years} yrs. {suggestion.reason}.{' '}
          <button type="button" className="link-button" onClick={applySuggestion}>Use this</button>
        </span>
      )
    }
    return null
  })()

  return (
    <Modal
      title={asset ? `Edit ${asset.assetName}` : 'Add asset'}
      onClose={onClose}
      footer={
        <>
          <button className="button" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" type="submit" form={FORM_ID}>{asset ? 'Save changes' : 'Submit for approval'}</button>
        </>
      }
    >
      {asset && (
        <div className="modal-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'is-active' : ''} onClick={() => setTab('details')}>Details</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}>History ({history.length})</button>
        </div>
      )}
      {locked && tab === 'details' && (
        <p className="lifecycle-locked"><Lock size={15} /> This asset is {asset!.status.toLowerCase()}: its historical figures are locked.</p>
      )}
      {tab === 'history' && <HistoryList entries={history} />}
      <form id={FORM_ID} className="asset-form" onSubmit={onSubmit} noValidate hidden={tab !== 'details'}>
        <h3 className="form-section-title">Asset</h3>
        <div className="form-grid">
          {field('assetName')}
          {field(
            'status',
            !asset ? (
              <span className="field-hint">New assets are saved as <strong>Pending Approval</strong> and join the plan once an approver approves them.</span>
            ) : isAutoFlagged(asset) ? (
              <span className="field-hint">Past its service life, so shown as <strong>Overdue</strong> automatically. Use <strong>Change status</strong> to replace or dispose of it.</span>
            ) : (
              <span className="field-hint">Use <strong>Change status</strong> on the row to move it through its lifecycle.</span>
            ),
          )}
          {field('owner')}
          {field('assetId')}
          {field(
            'registerNumber',
            !values.registerNumber.trim() && (
              <span className="field-hint">
                {registerPreview
                  ? <>Leave blank to assign <strong>{registerPreview}</strong> when saved.</>
                  : <>Assigned automatically once Structure Location Name and Year Installed are filled in.</>}
              </span>
            ),
          )}
          {field('ledgerId')}
          {field('majorProject')}
        </div>

        <h3 className="form-section-title">Location</h3>
        <div className="form-grid">
          {field(
            'structureLocation',
            departmentResult && (departmentResult.corrected || !knownDepartments.includes(departmentResult.name)) && (
              <span className="field-hint">
                {departmentResult.corrected
                  ? <>Will be saved as <strong>{departmentResult.name}</strong> (spelling corrected).</>
                  : <>New department: <strong>{departmentResult.name}</strong>.</>}
              </span>
            ),
          )}
          <datalist id="asset-departments">
            {knownDepartments.map((d) => <option key={d} value={d} />)}
          </datalist>
          {field('refinedLocation')}
          {field('roomArea')}
        </div>
        <datalist id="asset-owners">
          {owners.map((o) => <option key={o} value={o} />)}
        </datalist>

        <h3 className="form-section-title">Quantity, life & cost</h3>
        <div className="form-grid">
          {field('quantity')}
          {field('unitOfMeasure')}
          {field('yearInstalled')}
          {field('serviceLifeYears', lifeHint)}
          {field('invoiceNumber')}
          {field('purchaseCost', (
            <span className="field-hint">Total paid for the line when installed. Used to estimate replacement cost when no unit replacement cost is entered.</span>
          ))}
          {field('unitReplacementCost', (
            <span className="field-hint">Today's price per unit. Takes priority over Purchase Cost.</span>
          ))}
        </div>
        {variance != null && Math.abs(variance) > VARIANCE_THRESHOLD && (
          <p className="variance-warning">
            <AlertTriangle size={16} />
            <span>
              Note: estimated replacement cost ({formatMoney(replacementToday)}) is {Math.round(Math.abs(variance) * 100)}% {variance > 0 ? 'higher' : 'lower'} than the historical cost ({formatMoney(num(values.purchaseCost))}). Please verify before saving.
            </span>
          </p>
        )}
      </form>
    </Modal>
  )
}

/** Read-only activity log for one asset, newest first. */
function HistoryList({ entries }: { entries: ReturnType<typeof auditForAsset> }) {
  if (entries.length === 0) return <p className="muted history-empty">No changes recorded yet. Changes made from now on are logged here.</p>
  return (
    <ol className="history-list">
      {entries.map((e) => (
        <li key={e.id}>
          <div className="history-head">
            <strong>{e.action}</strong>
            <span className="muted">{new Date(e.at).toLocaleString()} · {e.userName} ({e.userRole})</span>
          </div>
          {e.changes.length > 0 && (
            <ul className="history-changes">
              {e.changes.map((c, i) => (
                <li key={i}><span className="history-field">{c.field}</span> <span className="history-from">{c.from}</span> → <span className="history-to">{c.to}</span></li>
              ))}
            </ul>
          )}
          {e.note && <p className="history-note">{e.note}</p>}
        </li>
      ))}
    </ol>
  )
}
