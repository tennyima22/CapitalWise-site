/** The club's standard departments. Files may also bring new departments; these are just the defaults. */
export const DEPARTMENTS = [
  'Administration',
  'F&B Front',
  'F&B Back',
  'Golf Shop',
  'Facilities',
  'Course Building',
  'Turf Equipment',
  'Course Irrigation',
  'Turf Building',
  'Golf Course',
  'Membership',
  'Events',
]

export type Department = string

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** URL-safe id, e.g. "F&B Front" -> "fb-front". */
export function departmentSlug(name: string) {
  return name.toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Find the department a URL slug refers to among `names` (standard departments are always included). */
export function departmentFromSlug(slug: string, names: string[] = []): Department | undefined {
  return [...DEPARTMENTS, ...names].find((d) => departmentSlug(d) === slug)
}

/** Other spellings seen in spreadsheets, mapped to the department they mean. */
const ALIASES: Record<string, Department> = {
  admin: 'Administration',
  facility: 'Facilities',
  turfbuiding: 'Turf Building',
  coursebuidling: 'Course Building',
  coursebuiding: 'Course Building',
  irrigation: 'Course Irrigation',
}

/**
 * The department name for a stored or typed value: a standard department when the value is one
 * (ignoring case, spaces and punctuation, plus known aliases like "Admin"), otherwise the value
 * itself, trimmed. Returns undefined for a blank value.
 */
export function matchDepartment(value: string): Department | undefined {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  const n = normalize(trimmed)
  if (!n) return undefined
  return DEPARTMENTS.find((d) => normalize(d) === n) ?? ALIASES[n] ?? trimmed
}

/** Edit distance allowing one swap of neighbouring letters ("buidling" -> "building" is 1). */
function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** How many typos to forgive: none for very short names, 1 for 5–7 letters, 2 for 8 or more. */
const allowedTypos = (letters: number) => (letters >= 8 ? 2 : letters >= 5 ? 1 : 0)

/**
 * The single name in `candidates` that `value` is a likely misspelling of, or undefined when none
 * is close enough or two candidates are equally close.
 */
export function closestDepartment(value: string, candidates: string[]): Department | undefined {
  const n = normalize(value)
  const limit = allowedTypos(n.length)
  if (limit === 0) return undefined
  let best: string | undefined
  let bestDistance = Infinity
  let tie = false
  for (const c of new Set(candidates)) {
    const dist = editDistance(n, normalize(c))
    if (dist === 0) return c
    if (dist < bestDistance) {
      best = c
      bestDistance = dist
      tie = false
    } else if (dist === bestDistance) {
      tie = true
    }
  }
  return best && bestDistance <= limit && !tie ? best : undefined
}

export interface DepartmentResolution {
  name: Department
  /** True when a spelling mistake was corrected to an existing department. */
  corrected: boolean
}

/**
 * Resolve a department name against the known departments (standard ones plus any already in use):
 * exact names and aliases map directly, close misspellings are corrected, anything else is kept as
 * a new department. Returns undefined for a blank value.
 */
export function resolveDepartment(value: string, known: string[]): DepartmentResolution | undefined {
  const matched = matchDepartment(value)
  if (!matched) return undefined
  const all = [...DEPARTMENTS, ...known]
  const exact = all.find((d) => normalize(d) === normalize(matched))
  if (exact) return { name: exact, corrected: false }
  const close = closestDepartment(matched, all)
  return close ? { name: close, corrected: true } : { name: matched, corrected: false }
}

/** Departments used by `assets`: standard ones first in their usual order, then others A–Z. */
export function departmentsInUse(assets: { structureLocation: string }[]): Department[] {
  const found = new Set(assets.map((a) => matchDepartment(a.structureLocation)).filter((d): d is string => !!d))
  const standard = DEPARTMENTS.filter((d) => found.has(d))
  const others = [...found].filter((d) => !DEPARTMENTS.includes(d)).sort((a, b) => a.localeCompare(b))
  return [...standard, ...others]
}
