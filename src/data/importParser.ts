import { ASSET_COLUMNS, loadAssets, parseField, type Asset } from './assets'
import { buildLifeIndex } from './usefulLife'
import { createRegisterNumberer } from './registerNumber'
import { parseCsv } from '../lib/csv'
import { DEPARTMENTS, closestDepartment, departmentsInUse, resolveDepartment } from './departments'

export interface ParsedRow {
  line: number
  asset: Asset
  errors: string[]
  /** Why the useful life was estimated, when the file left it blank. */
  lifeReason?: string
  /** The department exactly as written in the file. */
  rawDepartment: string
  /** The department as written in the file, when it was corrected to a different spelling. */
  departmentFrom?: string
  /** True when the register number was generated because the file left it blank. */
  registerAuto?: boolean
}

export interface ParseResult {
  fileName: string
  rows: ParsedRow[]
  missingColumns: string[]
  /** Line the column headers were found on (title rows above it are skipped). */
  headerLine: number
  /** Fields matched by more than one column, and which column was used. */
  duplicateColumns: { label: string; used: string; ignored: string[] }[]
  /** The file has no replacement cost column, so costs (and estimates) will be blank. */
  missingCost: boolean
  /** Department spellings that were corrected, e.g. "Faciltiies" -> "Facilities". */
  departmentCorrections: { from: string; to: string; count: number }[]
  /** Departments in the file that don't exist yet, with how many assets each has. */
  newDepartments: { name: string; count: number }[]
}

/**
 * Correct department spellings: names matching a known department (standard or already in the
 * register) map to it, close misspellings are corrected to it, and the rest become new departments.
 * Several spellings of the same new department are merged into the one used most in the file.
 */
function resolveDepartments(rows: ParsedRow[], existing: Asset[]) {
  const known = departmentsInUse(existing)
  const isKnown = (name: string) => DEPARTMENTS.includes(name) || known.includes(name)
  const newGroups: { spellings: Map<string, number> }[] = []
  const resolved = new Map<ParsedRow, { name: string; isNew: boolean }>()

  for (const r of rows) {
    const raw = r.asset.structureLocation
    const res = resolveDepartment(raw, known)
    if (!res) continue
    if (res.corrected || isKnown(res.name)) {
      resolved.set(r, { name: res.name, isNew: false })
      continue
    }
    // A new department: group it with any close spelling already seen in this file.
    const group = newGroups.find((g) => closestDepartment(raw, [...g.spellings.keys()]))
    if (group) group.spellings.set(raw, (group.spellings.get(raw) ?? 0) + 1)
    else newGroups.push({ spellings: new Map([[raw, 1]]) })
    resolved.set(r, { name: raw, isNew: true })
  }

  const canonical = new Map<string, string>()
  const newDepartments: { name: string; count: number }[] = []
  for (const g of newGroups) {
    const [name] = [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0]
    for (const spelling of g.spellings.keys()) canonical.set(spelling, name)
    newDepartments.push({ name, count: [...g.spellings.values()].reduce((s, n) => s + n, 0) })
  }

  const corrections = new Map<string, { from: string; to: string; count: number }>()
  const letters = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [r, { name, isNew }] of resolved) {
    const from = r.rawDepartment.trim()
    const to = isNew ? canonical.get(name)! : name
    // Report real spelling changes; differences in capitals, spaces or punctuation are just tidied.
    if (letters(from) !== letters(to)) {
      r.departmentFrom = from
      const key = `${from}→${to}`
      const c = corrections.get(key) ?? { from, to, count: 0 }
      c.count++
      corrections.set(key, c)
    }
    r.asset.structureLocation = to
  }
  return { departmentCorrections: [...corrections.values()].sort((a, b) => b.count - a.count), newDepartments: newDepartments.sort((a, b) => b.count - a.count) }
}

/** Spreadsheet column letter for a 0-based index: 0 -> A, 27 -> AB. */
const columnLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : columnLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)))

const matchColumn = (header: string) =>
  ASSET_COLUMNS.find((c) => [c.label, c.key, ...(c.aliases ?? [])].some((name) => normalize(name) === normalize(header)))

/** The header is the row (within the first 30) that matches the most known columns. */
function findHeaderRow(table: string[][]): number {
  let best = 0
  let bestCount = 0
  table.slice(0, 30).forEach((row, i) => {
    const count = new Set(row.map((h) => matchColumn(h)?.key).filter(Boolean)).size
    if (count > bestCount) {
      best = i
      bestCount = count
    }
  })
  return best
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Read an uploaded CSV into asset rows with validation, estimated useful lives and register numbers. */
export function parseImportFile(fileName: string, text: string, existing: Asset[] = loadAssets()): ParseResult {
  // Keep blank lines while locating rows so line numbers match the file; skip them as data.
  const table = parseCsv(text, { keepBlank: true })
  const headerIndex = findHeaderRow(table)
  const header = table[headerIndex] ?? []
  const body = table
    .map((cells, i) => ({ cells, line: i + 1 }))
    .slice(headerIndex + 1)
    .filter(({ cells }) => cells.some((c) => c.trim() !== ''))

  // Map each known column to its position in the file, matching "Asset ID", "asset_id", "assetId", aliases, etc.
  // When two columns match the same field (e.g. an original and an updated "Unit Replacement Value"),
  // the later one is used, since spreadsheets usually add updated figures to the right.
  const matches = new Map<keyof Asset, number[]>()
  header.forEach((h, i) => {
    const col = matchColumn(h)
    if (col) matches.set(col.key, [...(matches.get(col.key) ?? []), i])
  })
  const positions = new Map<keyof Asset, number>([...matches].map(([key, idxs]) => [key, idxs[idxs.length - 1]]))
  const duplicateColumns = [...matches]
    .filter(([, idxs]) => idxs.length > 1)
    .map(([key, idxs]) => ({
      label: ASSET_COLUMNS.find((c) => c.key === key)!.label,
      used: `${columnLetter(idxs[idxs.length - 1])} ("${header[idxs[idxs.length - 1]].trim()}")`,
      ignored: idxs.slice(0, -1).map((i) => columnLetter(i)),
    }))
  const missingColumns = ASSET_COLUMNS.filter((c) => c.required && !positions.has(c.key)).map((c) => c.label)

  const rows = body.map(({ cells, line }): ParsedRow => {
    const errors: string[] = []
    const asset = {} as Record<keyof Asset, string | number | null>
    let rawDepartment = ''

    for (const col of ASSET_COLUMNS) {
      const pos = positions.get(col.key)
      const raw = pos === undefined ? '' : (cells[pos] ?? '').trim()
      if (col.required && pos !== undefined && raw === '') errors.push(`${col.label} is required`)
      if (col.key === 'structureLocation') rawDepartment = raw
      const { value, error } = parseField(col, raw)
      if (error) errors.push(error)
      asset[col.key] = value
    }

    return { line, errors, rawDepartment, asset: { ...(asset as unknown as Asset), serviceLifeAuto: false } }
  })

  // Estimate blank useful lives from the asset name, learning from this file and the existing register.
  const index = buildLifeIndex([...existing, ...rows.map((r) => r.asset)])
  for (const r of rows) {
    if (r.asset.serviceLifeYears != null) continue
    const suggestion = index.suggest(r.asset.assetName)
    if (!suggestion) continue
    r.asset.serviceLifeYears = suggestion.years
    r.asset.serviceLifeAuto = true
    r.lifeReason = suggestion.reason
  }

  const departments = resolveDepartments(rows, existing)

  // Flag repeated Asset IDs within the file.
  const seen = new Map<string, number>()
  for (const r of rows) {
    const id = r.asset.assetId
    if (!id) continue
    if (seen.has(id)) r.errors.push(`Duplicate Asset ID (also on line ${seen.get(id)})`)
    else seen.set(id, r.line)
  }

  // Assign register numbers to importable rows that don't have one. An asset already in the
  // register keeps the number it has.
  const existingById = new Map(existing.map((a) => [a.assetId, a]))
  const numberer = createRegisterNumberer([...existing, ...rows.map((r) => r.asset)])
  for (const r of rows) {
    if (r.errors.length > 0 || r.asset.registerNumber) continue
    const kept = existingById.get(r.asset.assetId)?.registerNumber
    const assigned = kept || numberer.next(r.asset)
    if (!assigned) continue
    r.asset.registerNumber = assigned
    r.registerAuto = !kept
  }

  return { fileName, rows, missingColumns, headerLine: headerIndex + 1, duplicateColumns, missingCost: !positions.has('unitReplacementCost') && !positions.has('purchaseCost'), ...departments }
}
