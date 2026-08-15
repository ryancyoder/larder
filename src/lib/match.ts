/**
 * Matching "2 cups of finely chopped flat-leaf parsley" against a fridge item
 * literally called "parsley". Normalise both sides to a token set, then compare.
 */

/** Prep words, sizes and packaging that describe the ingredient rather than name it. */
const NOISE = new Set([
  'fresh', 'freshly', 'chopped', 'diced', 'minced', 'sliced', 'shredded', 'grated',
  'crushed', 'peeled', 'seeded', 'halved', 'quartered', 'cubed', 'julienned',
  'large', 'small', 'medium', 'jumbo', 'extra', 'ripe', 'organic', 'raw', 'cooked',
  'ground', 'whole', 'boneless', 'skinless', 'lean', 'thick', 'thin', 'finely',
  'coarsely', 'roughly', 'lightly', 'well', 'packed', 'drained', 'rinsed', 'divided',
  'to', 'taste', 'of', 'a', 'an', 'the', 'and', 'or', 'plus', 'more', 'for', 'serving',
  'optional', 'cold', 'warm', 'room', 'temperature', 'unsalted', 'salted', 'low',
  'reduced', 'free', 'range', 'good', 'quality', 'best', 'about', 'approximately',
  'can', 'cans', 'jar', 'jars', 'package', 'packages', 'pkg', 'box', 'bag', 'bunch',
  'head', 'clove', 'cloves', 'stalk', 'stalks', 'sprig', 'sprigs', 'piece', 'pieces',
  'slice', 'slices', 'pinch', 'dash', 'handful', 'container', 'tin',
])

/** Different words, same shopping-list line. */
const ALIASES: Record<string, string> = {
  scallion: 'green onion', scallions: 'green onion', 'spring onion': 'green onion',
  coriander: 'cilantro', garbanzo: 'chickpea', garbanzos: 'chickpea',
  aubergine: 'eggplant', courgette: 'zucchini', capsicum: 'bell pepper',
  rocket: 'arugula', prawn: 'shrimp', prawns: 'shrimp', mince: 'ground beef',
  passata: 'tomato sauce', stock: 'broth', yoghurt: 'yogurt', chilli: 'chili',
  'confectioners sugar': 'powdered sugar', 'castor sugar': 'sugar',
  'olive oil': 'olive oil', 'evoo': 'olive oil',
  'kosher salt': 'salt', 'sea salt': 'salt', 'table salt': 'salt',
  'black pepper': 'pepper', 'ground pepper': 'pepper', 'peppercorn': 'pepper',
}

/** Things almost everyone has; a recipe shouldn't be marked "can't cook" over salt. */
export const ASSUMED_STAPLES = new Set([
  'salt', 'pepper', 'water', 'olive oil', 'oil', 'vegetable oil', 'sugar', 'flour',
])

function singular(word: string): string {
  if (word.length <= 3) return word
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') || word.endsWith('ches') || word.endsWith('shes')) return word.slice(0, -2)
  if (word.endsWith('ves')) return word.slice(0, -3) + 'f'
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1)
  return word
}

/** Lowercase, strip quantities/parentheticals/punctuation, drop noise, singularise. */
export function normalize(raw: string): string {
  let s = raw.toLowerCase().trim()
  s = s.replace(/\([^)]*\)/g, ' ') // "(about 2 lbs)"
  s = s.replace(/[¼-¾⅐-⅞]/g, ' ') // vulgar fractions
  s = s.replace(/\d+([./]\d+)?/g, ' ') // bare numbers
  s = s.replace(/[^a-z\s-]/g, ' ')
  if (ALIASES[s.trim()]) s = ALIASES[s.trim()]
  const tokens = s
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(singular)
    .filter((t) => t.length > 1 && !NOISE.has(t))
  const joined = tokens.join(' ')
  return ALIASES[joined] ?? joined
}

export function tokensOf(raw: string): Set<string> {
  return new Set(normalize(raw).split(' ').filter(Boolean))
}

/**
 * 0 = unrelated, 1 = the same thing. A subset match ("parsley" ⊂ "flat leaf
 * parsley") scores high on purpose: pantry labels are shorter than recipe lines.
 */
export function similarity(a: string, b: string): number {
  const A = tokensOf(a)
  const B = tokensOf(b)
  if (!A.size || !B.size) return 0

  const na = [...A].join(' ')
  const nb = [...B].join(' ')
  if (na === nb) return 1

  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  if (!shared) return 0

  const smaller = Math.min(A.size, B.size)
  // Every word of the shorter name appears in the longer one → treat as the same item.
  if (shared === smaller) return 0.92
  return shared / (A.size + B.size - shared)
}

export const MATCH_THRESHOLD = 0.5

export function isMatch(a: string, b: string): boolean {
  return similarity(a, b) >= MATCH_THRESHOLD
}

/** Best match from a list, or null if nothing clears the threshold. */
export function bestMatch<T>(query: string, pool: T[], nameOf: (t: T) => string): T | null {
  let best: { value: T; score: number } | null = null
  for (const candidate of pool) {
    const score = similarity(query, nameOf(candidate))
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { value: candidate, score }
    }
  }
  return best?.value ?? null
}

export function isAssumedStaple(name: string): boolean {
  const n = normalize(name)
  return ASSUMED_STAPLES.has(n) || [...ASSUMED_STAPLES].some((s) => normalize(s) === n)
}

/** Title Case for display, preserving the user's own capitalisation if they used any. */
export function titleCase(s: string): string {
  if (s !== s.toLowerCase()) return s
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}
