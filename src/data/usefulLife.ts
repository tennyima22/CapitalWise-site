import { parseServiceLife, type Asset } from './assets'

/**
 * Built-in useful-life rules, checked in order against the asset name, so put specific
 * patterns before general ones (e.g. "mower reel" before "mower"). Ranges follow the
 * most common values in the club's existing register.
 */
const RULES: [pattern: string, life: string][] = [
  // Mechanical / HVAC / plumbing
  ['roof top unit|\\brtu\\b', '18 to 20'],
  ['make up air', '20 to 25'],
  ['mini split', '10 to 12'],
  ['exhaust (fan|hood)', '20 to 25'],
  ['domestic water heater|tankless', '10 to 12'],
  ['booster heater', '10 to 12'],
  ['storage tank|boiler|water softener', '12 to 15'],
  ['heater', '25 to 30'],
  ['jockey', '5 to 10'],
  ['pump (&|and) motor', '10 to 12'],
  ['fuel pump|pump', '15 to 18'],
  ['variable frequency drive|\\bvfd\\b|satellite controller', '15 to 18'],
  ['system controller', '12 to 15'],
  ['subsurface irrigation', '25 to 30'],
  ['life safety', '15 to 18'],

  // Building envelope & finishes
  ['roof.*metal', '30 to 35'],
  ['roof.*(tile|clay)', '30 to 35'],
  ['roof.*epdm', '18 to 20'],
  ['roof.*flat', '15 to 18'],
  ['roof', '20 to 25'],
  ['window treatment|solar shade|drapery|blind', '15 to 18'],
  ['window|nana wall', '35 to 40'],
  ['door, overhead|overhead door', '15 to 18'],
  ['door', '20 to 25'],
  ['siding', '20 to 25'],
  ['awning, structure', '20 to 25'],
  ['awning', '8 to 10'],
  ['acoustical ceiling|ceiling tile', 'to 20'],
  ['flooring.*tile|tile.*flooring|flooring, rubber', '12 to 15'],
  ['flooring.*epoxy|dance floor', 'to 10'],
  ['flooring|carpet|vinyl', '10 to 12'],
  ['renovation|washroom', '15 to 18'],
  ['cabinetry|millwork|counter', 'to 20'],
  ['paint|walls', '6 to 8'],
  ['sconce', '15 to 18'],
  ['light fixture|lighting|chandelier|pendant', '20 to 25'],
  ['signage|sign\\b', 'to 20'],

  // Site & golf course
  ['asphalt.*(seal|crack)', '3 to 5'],
  ['asphalt|pavement|paving', 'to 20'],
  ['cart path', 'to 1'],
  ['greens', '18 to 20'],
  ['fairways|rough', '20 to 25'],
  ['bunkers', '12 to 15'],
  ['tees', '5 to 7'],
  ['bridge', 'to 10'],
  ['tournament clock', '20 to 25'],
  ['weather station', '12 to 15'],

  // Kitchen & bar
  ['dishwasher', '18 to 20'],
  ['glass washer|fryer|pasta cooker|food processor', '10 to 12'],
  ['weed steamer', '20 to 25'],
  ['mixer|tilt skillet', '20 to 25'],
  ['warming cabinet|steam kettle', '15 to 18'],
  ['steamer', '10 to 12'],
  ['beer delivery', '15 to 18'],
  ['refrigerator|fridge|freezer|cooler|chiller|walk-in|ice machine|ice cream|evaporator|compressor|glycol', '12 to 15'],
  ['oven|range|flattop|charbroiler|griddle|smoker|slicer|cook & hold|vacuum sealer', '12 to 15'],
  ['chafing', 'to 5'],
  ['laundry|washer/dryer', '8 to 10'],

  // Turf equipment
  ['mower reel|verticutt', '10 to 12'],
  ['reelmaster|traction unit', '8 to 10'],
  ['mower', '12 to 15'],
  ['aerator|coring', '10 to 12'],
  ['bunker rake|sprayer|topdresser|sod cutter|seeder|spreader|gps', '10 to 12'],
  ['snow blower', '12 to 15'],
  ['blower', '6 to 8'],
  ['snow groomer|roller\\b', '8 to 10'],
  ['stump grinder', 'to 20'],
  ['grinder|track system|equipment wash', '12 to 15'],
  ['tiller|chipper|trencher|material handler|skid steer|backhoe', '15 to 18'],
  ['tractor|loader|excavator|trailer|container|welder|plasma cutter|generator|pressure washer|log splitter|moisture removal', 'to 20'],
  ['mechanic lift|hoist', '20 to 25'],
  ['attachment', '12 to 15'],

  // Vehicles
  ['golf cart|vehicle, club car\\s*$|club car transporter', 'to 5'],
  ['carry ?all|workman, mdx', '12 to 15'],
  ['vehicle|cushman|hauler|truck|\\bvan\\b|gator|utv|rtv', '10 to 12'],
  ['pull cart', '3 to 5'],

  // Technology & golf shop
  ['computer|server|switches|access point|surface pro', '5 to 7'],
  ['security|camera|audio|visual|\\btv\\b', '5 to 7'],
  ['flight monitor|trackman|flight ?scope|launch monitor', '5 to 7'],
  ['artificial turf|hitting mat|\\bmats?\\b|ball washer', '5 to 7'],
  ['radio', '12 to 15'],

  // Furniture
  ['reupholster', '6 to 8'],
  ['furniture.*(chair|stool|sofa|banquette|seating|lounge)', '12 to 15'],
  ['furniture', '15 to 18'],

  ['emergency capital', 'to 1'],
]

const COMPILED = RULES.map(([pattern, life]) => ({ re: new RegExp(pattern, 'i'), life }))

export interface LifeSuggestion {
  years: number
  /** Range or value the suggestion came from, e.g. "12 to 15". */
  text: string
  /** Why this was suggested, for display. */
  reason: string
}

/**
 * Name prefixes from most to least specific, e.g. "Vehicle, Toro, Workman, MDX" ->
 * ["vehicle, toro, workman, mdx", "vehicle, toro, workman", "vehicle, toro", "vehicle"].
 */
function namePrefixes(name: string): string[] {
  const parts = name.replace(/\*/g, '').toLowerCase().split(',').map((p) => p.trim()).filter(Boolean)
  return parts.map((_, i) => parts.slice(0, parts.length - i).join(', '))
}


export interface LifeIndex {
  suggest: (assetName: string) => LifeSuggestion | null
}

/**
 * Build a suggester that learns from assets that already have a useful life entered, using the
 * most common value among the most similar names (at least two words of the name in common),
 * then the built-in rules, then any single asset of the same type.
 */
export function buildLifeIndex(known: Pick<Asset, 'assetName' | 'serviceLifeYears' | 'serviceLifeAuto'>[]): LifeIndex {
  const byPrefix = new Map<string, Map<number, number>>()
  for (const a of known) {
    if (a.serviceLifeYears == null || a.serviceLifeAuto) continue
    for (const prefix of namePrefixes(a.assetName)) {
      const counts = byPrefix.get(prefix) ?? new Map<number, number>()
      counts.set(a.serviceLifeYears, (counts.get(a.serviceLifeYears) ?? 0) + 1)
      byPrefix.set(prefix, counts)
    }
  }

  const fromRegister = (name: string, { minParts, minMatches }: { minParts: number; minMatches: number }): LifeSuggestion | null => {
    for (const prefix of namePrefixes(name)) {
      if (prefix.split(', ').length < minParts) break
      const counts = byPrefix.get(prefix)
      if (!counts) continue
      const total = [...counts.values()].reduce((s, n) => s + n, 0)
      if (total < minMatches) continue
      const [years, n] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]
      // Show the matched part of the name as the user typed it.
      const label = name.replace(/\*/g, '').split(',').map((p) => p.trim()).filter(Boolean).slice(0, prefix.split(', ').length).join(', ')
      return { years, text: `${years}`, reason: `Matches ${total === 1 ? 'a similar asset' : `${total} similar assets`} ("${label}") in your register${total > 1 ? ` (${n} of ${total} use ${years} yrs)` : ''}` }
    }
    return null
  }

  const fromRules = (name: string): LifeSuggestion | null => {
    for (const rule of COMPILED) {
      const match = rule.re.exec(name)
      if (!match) continue
      const years = parseServiceLife(rule.life)
      return years == null ? null : { years, text: rule.life, reason: `Name contains "${match[0].trim()}": typically ${rule.life} years` }
    }
    return null
  }

  return {
    suggest: (assetName) => {
      if (!assetName.trim()) return null
      return (
        fromRegister(assetName, { minParts: 2, minMatches: 1 }) ??
        fromRules(assetName) ??
        fromRegister(assetName, { minParts: 1, minMatches: 1 })
      )
    },
  }
}
