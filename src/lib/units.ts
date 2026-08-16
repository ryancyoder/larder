import type { Unit } from '../db/schema'

type Dimension = 'mass' | 'volume' | 'count'

/** Conversion factor to the dimension's base unit (g, ml, or "one of them"). */
const UNITS: Record<Unit, { dim: Dimension; factor: number; label: string; plural?: string }> = {
  g: { dim: 'mass', factor: 1, label: 'g' },
  kg: { dim: 'mass', factor: 1000, label: 'kg' },
  oz: { dim: 'mass', factor: 28.3495, label: 'oz' },
  lb: { dim: 'mass', factor: 453.592, label: 'lb' },

  ml: { dim: 'volume', factor: 1, label: 'ml' },
  l: { dim: 'volume', factor: 1000, label: 'L' },
  tsp: { dim: 'volume', factor: 4.92892, label: 'tsp' },
  tbsp: { dim: 'volume', factor: 14.7868, label: 'tbsp' },
  cup: { dim: 'volume', factor: 236.588, label: 'cup', plural: 'cups' },
  floz: { dim: 'volume', factor: 29.5735, label: 'fl oz' },
  qt: { dim: 'volume', factor: 946.353, label: 'qt' },
  gal: { dim: 'volume', factor: 3785.41, label: 'gal' },

  ea: { dim: 'count', factor: 1, label: '' },
  bunch: { dim: 'count', factor: 1, label: 'bunch', plural: 'bunches' },
  can: { dim: 'count', factor: 1, label: 'can', plural: 'cans' },
  pkg: { dim: 'count', factor: 1, label: 'pkg', plural: 'pkgs' },
  slice: { dim: 'count', factor: 1, label: 'slice', plural: 'slices' },
  clove: { dim: 'count', factor: 1, label: 'clove', plural: 'cloves' },
  head: { dim: 'count', factor: 1, label: 'head', plural: 'heads' },
  loaf: { dim: 'count', factor: 1, label: 'loaf', plural: 'loaves' },
  dozen: { dim: 'count', factor: 12, label: 'dozen' },
}

export const ALL_UNITS = Object.keys(UNITS) as Unit[]

export function dimensionOf(unit: Unit): Dimension {
  return UNITS[unit].dim
}

/** Counted things ('ea', 'can', 'pkg') can carry a pack size; 'lb' cannot. */
export function isCountUnit(unit: Unit): boolean {
  return UNITS[unit].dim === 'count'
}

/** Units offered for the pack-size field — only real measures. */
export const MEASURE_UNITS = ALL_UNITS.filter((u) => UNITS[u].dim !== 'count')

/** Count units that are genuinely interchangeable. A clove is not a head. */
const COUNT_INTERCHANGEABLE = new Set<Unit>(['ea', 'dozen'])

/**
 * Same dimension → a real number. Otherwise null, meaning "we can't compare
 * these amounts" — callers treat that as *having* the ingredient rather than
 * inventing a shortfall. Mass and volume convert cleanly; count units only do
 * when they mean the same thing, so "5 cloves" never reads as more than
 * "2 heads" of garlic.
 */
export function convert(qty: number, from: Unit, to: Unit): number | null {
  const a = UNITS[from]
  const b = UNITS[to]
  if (a.dim !== b.dim) return null
  if (a.dim === 'count' && from !== to) {
    if (!COUNT_INTERCHANGEABLE.has(from) || !COUNT_INTERCHANGEABLE.has(to)) return null
  }
  return (qty * a.factor) / b.factor
}

/** Trims float noise: 0.5 → "½", 2.0 → "2", 1.333 → "1.33". */
export function formatQty(qty: number): string {
  if (!Number.isFinite(qty)) return '—'
  const rounded = Math.round(qty * 100) / 100
  if (Number.isInteger(rounded)) return String(rounded)
  const fractions: Array<[number, string]> = [
    [0.25, '¼'], [0.33, '⅓'], [0.5, '½'], [0.67, '⅔'], [0.75, '¾'],
  ]
  const whole = Math.floor(rounded)
  const frac = Math.round((rounded - whole) * 100) / 100
  for (const [value, glyph] of fractions) {
    if (Math.abs(frac - value) < 0.02) return whole ? `${whole}${glyph}` : glyph
  }
  return String(rounded)
}

export interface Sized {
  unit: Unit
  size?: number
  sizeUnit?: Unit
}

/**
 * Total measure held across every package — 3 cans × 400 g = 1200 g.
 * Null when the item has no pack size, which is the honest answer rather than
 * a guess.
 */
export function packTotal(qty: number, item: Sized): { value: number; unit: Unit } | null {
  if (!item.size || !item.sizeUnit || !isCountUnit(item.unit)) return null
  return { value: qty * item.size, unit: item.sizeUnit }
}

/** "3 cans · 400g each" — the count leads, because that's what you count. */
export function formatPack(qty: number, item: Sized): string {
  const base = formatAmount(qty, item.unit)
  if (!item.size || !item.sizeUnit || !isCountUnit(item.unit)) return base
  return `${base} · ${formatAmount(item.size, item.sizeUnit)} each`
}

export function formatAmount(qty: number, unit: Unit): string {
  const meta = UNITS[unit]
  const n = formatQty(qty)
  if (!meta.label) return n
  const label = qty === 1 || !meta.plural ? meta.label : meta.plural
  // Metric/imperial abbreviations read better tight against the number.
  const tight = ['g', 'kg', 'ml', 'L', 'oz', 'lb'].includes(meta.label)
  return tight ? `${n}${meta.label}` : `${n} ${label}`
}
