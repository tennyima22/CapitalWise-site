import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import { ASSET_COLUMNS, SAMPLE_HEADERS, SAMPLE_ROWS, clearAssets, loadAssets, upsertAssets } from '../../data/assets'
import { parseImportFile, type ParseResult } from '../../data/importParser'
import { downloadFile, toCsv } from '../../lib/csv'
import { useAuth } from '../../auth/authContext'
import { appendAudit, diffAssets, entry, type Actor } from '../../data/audit'
import { isAdministrator } from '../../data/lifecycle'
import { archiveDeleted } from '../../data/deletedAssets'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const PREVIEW_ROWS = 50

function downloadSample() {
  downloadFile('asset-import-sample.csv', toCsv(SAMPLE_HEADERS, SAMPLE_ROWS), 'text/csv;charset=utf-8')
}

export default function Import() {
  const { user } = useAuth()
  const actor: Actor = { name: user?.name ?? 'Unknown', email: user?.email ?? '', role: user?.role ?? 'Staff' }
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [done, setDone] = useState<{ added: number; updated: number; estimated: number; numbered: number } | null>(null)
  const [previewFilter, setPreviewFilter] = useState<'all' | 'errors' | 'estimated'>('all')
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [replaceAll, setReplaceAll] = useState(false)
  const existingCount = loadAssets().length

  // In replace mode the old register is ignored, so register numbers and useful-life estimates start fresh.
  const parse = (f: { name: string; text: string }, replace: boolean) => parseImportFile(f.name, f.text, replace ? [] : loadAssets())

  const onReplaceChange = (replace: boolean) => {
    setReplaceAll(replace)
    if (file) setResult(parse(file, replace))
  }

  const reset = () => {
    setResult(null)
    setFile(null)
    setError('')
    setDone(null)
    setPreviewFilter('all')
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = async (file: File | undefined) => {
    reset()
    if (!file) return
    if (!/\.csv$/i.test(file.name)) return setError('Please choose a .csv file. In Excel, use File → Save As → CSV.')
    if (file.size > MAX_FILE_BYTES) return setError('That file is larger than 5 MB.')
    const loaded = { name: file.name, text: await file.text() }
    const parsed = parse(loaded, replaceAll)
    if (parsed.rows.length === 0) return setError('That file has no data rows below the header.')
    setFile(loaded)
    setResult(parsed)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const validRows = result?.rows.filter((r) => r.errors.length === 0) ?? []
  const invalidCount = (result?.rows.length ?? 0) - validRows.length
  const canImport = !!result && result.missingColumns.length === 0 && validRows.length > 0
  const estimatedCount = result?.rows.filter((r) => r.lifeReason).length ?? 0
  const previewRows =
    result?.rows.filter((r) => (previewFilter === 'errors' ? r.errors.length > 0 : previewFilter === 'estimated' ? !!r.lifeReason : true)) ?? []

  const onImport = () => {
    if (replaceAll && !isAdministrator(actor.role)) return
    if (replaceAll && !window.confirm(`Delete all ${existingCount} existing assets and replace them with the ${validRows.length} assets in this file? This cannot be undone.`)) return
    const before = new Map((replaceAll ? [] : loadAssets()).map((a) => [a.assetId, a]))
    if (replaceAll) {
      archiveDeleted(loadAssets(), actor, `Replaced by import of ${file?.name ?? 'a file'}`)
      clearAssets()
      appendAudit([entry(actor, { assetId: '—', assetName: 'Whole register' }, 'Register cleared', [], `Replaced ${existingCount} assets with ${file?.name ?? 'an imported file'}`)])
    }
    const counts = upsertAssets(validRows.map((r) => r.asset))
    // Log each imported asset: new ones with all their values, updated ones with what changed.
    appendAudit(
      validRows.flatMap((r) => {
        const old = before.get(r.asset.assetId)
        const changes = diffAssets(old, r.asset)
        return !old || changes.length ? [entry(actor, r.asset, 'Imported', changes, `From ${file?.name ?? 'file'}${old ? ' (updated)' : ''}`)] : []
      }),
    )
    setDone({
      ...counts,
      estimated: validRows.filter((r) => r.lifeReason).length,
      numbered: validRows.filter((r) => r.registerAuto).length,
    })
    setResult(null)
  }

  return (
    <>
      <PageHeader title="Import" description="Add or update assets in bulk from a CSV file." />

      {done ? (
        <div className="card empty-state">
          <CheckCircle2 size={28} strokeWidth={1.5} className="success-icon" />
          <h2>Import complete</h2>
          <p>{done.added} asset{done.added === 1 ? '' : 's'} added, {done.updated} updated.</p>
          {done.numbered > 0 && <p>{done.numbered} register number{done.numbered === 1 ? ' was' : 's were'} assigned automatically.</p>}
          {done.estimated > 0 && (
            <p>{done.estimated} useful li{done.estimated === 1 ? 'fe was' : 'ves were'} estimated from the asset name. They're marked "auto" in the Asset Register for review.</p>
          )}
          <div className="button-row">
            <button className="button" onClick={reset}>Import another file</button>
            <Link className="button primary" to="/reports/export">Go to Export</Link>
          </div>
        </div>
      ) : (
        <div className="card form-card">
          <div className="import-help">
            <p>
              Required columns: <strong>{ASSET_COLUMNS.filter((c) => c.required).map((c) => c.label).join(', ')}</strong>.
              Rows with an Asset ID that already exists will update that asset. Register numbers are assigned automatically for
              every asset when you upload (department code + year installed + count, e.g. FAC2026001) and are included when you export. Download the sample to see the expected layout.
            </p>
            <button className="button with-icon" onClick={downloadSample}>
              <Download size={16} /> Download sample
            </button>
          </div>

          {!result && (
            <div
              className={`dropzone${dragging ? ' is-dragging' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
            >
              <Upload size={24} strokeWidth={1.5} />
              <span className="dropzone-title">Drop a CSV file here, or click to browse</span>
              <span className="muted">Up to 5 MB</span>
              <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          {result && (
            <>
              <div className="file-bar">
                <FileSpreadsheet size={18} />
                <span className="file-name">{result.fileName}</span>
                <span className="muted">
                  {result.rows.length} row{result.rows.length === 1 ? '' : 's'} · {validRows.length} ready
                  {invalidCount > 0 && <span className="text-error"> · {invalidCount} with errors</span>}
                  {estimatedCount > 0 && <span className="text-auto"> · {estimatedCount} useful lives estimated</span>}
                </span>
                <button className="icon-button" aria-label="Remove file" onClick={reset}><X size={16} /></button>
              </div>

              {result.headerLine > 1 && (
                <p className="import-notice">Column headers found on line {result.headerLine}; the {result.headerLine - 1} title row{result.headerLine === 2 ? '' : 's'} above {result.headerLine === 2 ? 'was' : 'were'} skipped.</p>
              )}
              {result.departmentCorrections.length > 0 && (
                <div className="import-notice">
                  <strong>Department spellings corrected:</strong>{' '}
                  {result.departmentCorrections.map((c, i) => (
                    <span key={`${c.from}→${c.to}`}>{i > 0 && ' · '}&ldquo;{c.from}&rdquo; → {c.to} ({c.count})</span>
                  ))}
                </div>
              )}
              {result.newDepartments.length > 0 && (
                <div className="import-notice">
                  <strong>New department{result.newDepartments.length === 1 ? '' : 's'} will be added:</strong>{' '}
                  {result.newDepartments.map((d, i) => (
                    <span key={d.name}>{i > 0 && ' · '}{d.name} ({d.count})</span>
                  ))}
                  . Check these are not typos before importing.
                </div>
              )}
              {result.duplicateColumns.map((d) => (
                <p key={d.label} className="import-notice">
                  More than one column matches <strong>{d.label}</strong>: using column {d.used}, the later (updated) one, and ignoring column {d.ignored.join(', ')}.
                </p>
              ))}
              {result.missingCost && (
                <p className="import-warning">
                  This file has no cost column, so replacement costs and estimates will be blank. Add a <strong>Purchase Cost</strong> column
                  (total paid when installed) or a <strong>Unit Replacement Cost</strong> column (today's price per unit).
                </p>
              )}
              {result.missingColumns.length > 0 && (
                <p className="form-error">
                  Missing required column{result.missingColumns.length === 1 ? '' : 's'}: {result.missingColumns.join(', ')}.
                  Check the header row against the template.
                </p>
              )}

              <div className="chips" role="group" aria-label="Preview filter">
                {([
                  ['all', `All rows (${result.rows.length})`],
                  ['errors', `With errors (${invalidCount})`],
                  ['estimated', `Estimated useful life (${estimatedCount})`],
                ] as const).map(([value, label]) => (
                  <button key={value} className={`chip${previewFilter === value ? ' is-selected' : ''}`} onClick={() => setPreviewFilter(value)}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      {ASSET_COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                      <th>Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, PREVIEW_ROWS).map((r) => (
                      <tr key={r.line} className={r.errors.length ? 'has-error' : ''}>
                        <td className="muted">{r.line}</td>
                        {ASSET_COLUMNS.map((c) => (
                          <td key={c.key} className={c.type === 'text' ? '' : 'num'}>
                            {String(r.asset[c.key] ?? '')}
                            {c.key === 'serviceLifeYears' && r.lifeReason && <span className="auto-tag" title={r.lifeReason}>auto</span>}
                            {c.key === 'structureLocation' && r.departmentFrom && <span className="auto-tag" title={`Corrected from "${r.departmentFrom}"`}>corrected</span>}
                            {c.key === 'registerNumber' && r.registerAuto && <span className="auto-tag" title="Assigned automatically: department code + year installed + count">auto</span>}
                          </td>
                        ))}
                        <td>
                          {r.errors.length > 0 && <div className="text-error">{r.errors.join('; ')}</div>}
                          {r.lifeReason && <div className="text-auto">Useful life estimated. {r.lifeReason}</div>}
                        </td>
                      </tr>
                    ))}
                    {previewRows.length === 0 && (
                      <tr><td colSpan={ASSET_COLUMNS.length + 2} className="muted table-empty">No rows in this view.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {previewRows.length > PREVIEW_ROWS && (
                <p className="muted">Showing the first {PREVIEW_ROWS} of {previewRows.length} rows.</p>
              )}

              {existingCount > 0 && isAdministrator(actor.role) && (
                <label className={`replace-option${replaceAll ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={replaceAll} onChange={(e) => onReplaceChange(e.target.checked)} />
                  <span>
                    <strong>Replace all existing assets with this file</strong>
                    <span className="muted">
                      {replaceAll
                        ? `The ${existingCount} assets in the register now will be deleted. Register numbers start again from 001.`
                        : `Leave unticked to add to the ${existingCount} assets already in the register (matching Asset IDs are updated).`}
                    </span>
                  </span>
                </label>
              )}

              <div className="form-footer">
                <span className="muted">{invalidCount > 0 ? 'Rows with errors will be skipped.' : 'All rows look good.'}</span>
                <div className="button-row">
                  <button className="button" onClick={reset}>Cancel</button>
                  <button className="button primary" onClick={onImport} disabled={!canImport}>
                    {replaceAll ? 'Replace with' : 'Import'} {validRows.length} asset{validRows.length === 1 ? '' : 's'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
