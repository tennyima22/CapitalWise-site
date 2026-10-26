import type { Asset } from './assets'
import { matchDepartment } from './departments'

/**
 * Register number prefix for a department: its first three letters ("Facilities" -> "FAC",
 * "F&B Front" -> "FBF", a new "Pro Shop" -> "PRO"). Some departments share a prefix (e.g. Golf Shop
 * and Golf Course are both "GOL"); numbers stay unique because the count is kept per prefix and year.
 */
export function departmentCode(name: string) {
  return name.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase().padEnd(3, 'X')
}

/** "FAC2026" for a Facilities asset installed in 2026, or null if the department or year is missing. */
export function registerPrefix(asset: Pick<Asset, 'structureLocation' | 'yearInstalled'>): string | null {
  const department = matchDepartment(asset.structureLocation)
  if (!department || asset.yearInstalled == null) return null
  return `${departmentCode(department)}${asset.yearInstalled}`
}

export interface RegisterNumberer {
  /** The next free register number for this asset, e.g. "FAC2026003", without reserving it. */
  peek: (asset: Pick<Asset, 'structureLocation' | 'yearInstalled'>) => string | null
  /** Assign the next free register number and reserve it. */
  next: (asset: Pick<Asset, 'structureLocation' | 'yearInstalled'>) => string | null
}

/**
 * Hands out register numbers in the form PREFIX + YEAR + 3-digit count (FAC2026001, FAC2026002, …),
 * continuing after the highest number already used for that prefix and year.
 */
export function createRegisterNumberer(existing: Pick<Asset, 'registerNumber'>[]): RegisterNumberer {
  const highest = new Map<string, number>()
  for (const { registerNumber } of existing) {
    const m = registerNumber?.trim().toUpperCase().match(/^([A-Z]{3}\d{4})(\d{3,})$/)
    if (m) highest.set(m[1], Math.max(highest.get(m[1]) ?? 0, Number(m[2])))
  }

  const format = (prefix: string, n: number) => `${prefix}${String(n).padStart(3, '0')}`

  return {
    peek: (asset) => {
      const prefix = registerPrefix(asset)
      return prefix ? format(prefix, (highest.get(prefix) ?? 0) + 1) : null
    },
    next: (asset) => {
      const prefix = registerPrefix(asset)
      if (!prefix) return null
      const n = (highest.get(prefix) ?? 0) + 1
      highest.set(prefix, n)
      return format(prefix, n)
    },
  }
}
