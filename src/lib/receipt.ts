import { db } from '../db/db'
import type { Category, InboxItem, Nutrition, Trip, Unit } from '../db/schema'
import { addItem } from './inventory'
import { suggestExpiry, suggestPlace } from './locations'
import { todayISO } from './dates'
import { recordPurchase, upsertProduct } from './products'

/**
 * Reading a till receipt.
 *
 * The third way into the kitchen, after a batch of photos and the rapid
 * scanner. It is the only one that knows what things *cost*, which is why it
 * exists: the ledger has had a `value` column since the beginning and almost
 * nothing to put in it.
 *
 * Everything above `commitReceipt` is pure — text in, lines out, no network and
 * no database. That is deliberate. Receipt layouts differ per chain and this
 * parser will be wrong about somebody's receipt sooner or later, so being able
 * to run it over a pasted string and look at the result is the whole debugging
 * story.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * A discount is kept rather than dropped so the totals reconcile. It never
 * becomes an item — you cannot put -$1.50 in the fridge — but leaving it out
 * would make every receipt with a coupon look mis-read.
 */
export type LineKind = 'item' | 'discount'

export interface ReceiptLine {
  /** Stable across edits, so React keys and per-line state survive a re-render. */
  key: string
  /** The line exactly as it came in, so a mis-parse is inspectable on screen. */
  raw: string
  kind: LineKind
  barcode?: string
  /**
   * The shop's own item number, where the line printed one. Not a barcode and
   * never sent to Open Food Facts — it is the key the product catalogue uses to
   * recognise this line next time.
   */
  sku?: string
  /** Expanded and title-cased — what goes on the shelf if nothing better turns up. */
  description: string
  /** Untouched till text, kept because the expansion is a guess and can be wrong. */
  rawDescription: string
  qty: number
  /**
   * What `qty` counts. Loose goods are sold by weight and the receipt says so,
   * so 2.14 lb of bananas is recorded as pounds rather than as two bananas.
   */
  unit: Unit
  /** What the line cost in total, not per unit. */
  price?: number
  /** Pack size read off the description: "MOZZ 8Z" → 8 oz. */
  size?: number
  sizeUnit?: Unit
  /** Unticked lines are ignored on import. Discounts start unticked and stay so. */
  include: boolean
}

export interface ParsedReceipt {
  store?: string
  /** ISO date. Absent when nothing on the receipt looked like one. */
  date?: string
  lines: ReceiptLine[]
  /** The total the receipt itself printed, for comparison against the sum. */
  printedTotal?: number
  /** Count of lines read and discarded as not being purchases. */
  ignored: number
}

// ---------------------------------------------------------------------------
// What is not an item
// ---------------------------------------------------------------------------

/**
 * Receipt furniture. Matched against the whole line, so a product legitimately
 * containing one of these words survives as long as the line also has a price
 * and a barcode — "TOTAL CEREAL" is a real thing you can buy.
 */
const NOISE = [
  // `\W*` because a receipt decorates its own total: "**** TOTAL", "== TOTAL".
  /^\W*sub\s*-?\s*total\b/i,
  /^\W*total\b/i,
  // `taxable` too: ALDI itemises "C-Taxable @7.000%", and \btax\b alone will
  // not match it.
  /\btax(?:able|es)?\b|\btx\b/i,
  /^\W*amount\s+due\b/i,
  /^\W*\d+\s+items?\b/i,
  // A rate line: "T = TX 7.0000% on 3.49". The percent sign is the giveaway,
  // and no grocery description carries one except "2% MILK", which has no
  // decimal rate beside it.
  /\d\s*\.\s*\d{3,}\s*%|\d%\s+on\b/i,
  /^balance\b/i,
  /^change\b/i,
  /^cash\b/i,
  /\b(debit|credit|visa|mastercard|amex|discover|ebt|snap)\b/i,
  /\btend(er(ed)?)?\b/i,
  /\bcharge\b/i,
  /^(approved|auth|ref|account|card|chip|aid|terminal|network id)\b/i,
  /\bitems? sold\b/i,
  /^#?\s*items\b/i,
  /^tc#/i,
  /\bthank you\b/i,
  /\b(you saved|total savings|savings)\b/i,
  /\b(member|membership)\s*(#|number)/i,
  /^(store|st#|op#|te#|tr#|mgr|manager)\b/i,
  /\breturn policy\b/i,
  /\bsurvey\b/i,
  /(www\.|https?:\/\/)/i,
  /^\s*[-=*_]{3,}\s*$/,
  /^\(?\d{3}\)?[-\s]?\d{3}-\d{4}$/, // a phone number
]

/**
 * Needle to match, and the name to show. Written out rather than derived,
 * because no capitalisation rule gets ALDI, BJ's and Hy-Vee all right.
 * Longer needles first, so "sam's club" is not shadowed by a shorter match.
 */
const CHAINS: Array<[string, string]> = [
  ['aldi', 'ALDI'],
  ['walmart', 'Walmart'],
  ['target', 'Target'],
  ['kroger', 'Kroger'],
  ['costco', 'Costco'],
  ["sam's club", "Sam's Club"],
  ['sams club', "Sam's Club"],
  ['publix', 'Publix'],
  ['safeway', 'Safeway'],
  ['trader joe', "Trader Joe's"],
  ['whole foods', 'Whole Foods'],
  ['meijer', 'Meijer'],
  ['h-e-b', 'H-E-B'],
  ['wegmans', 'Wegmans'],
  ['food lion', 'Food Lion'],
  ['winn-dixie', 'Winn-Dixie'],
  ['sprouts', 'Sprouts'],
  ['hy-vee', 'Hy-Vee'],
  ['hyvee', 'Hy-Vee'],
  ['albertsons', 'Albertsons'],
  ['harris teeter', 'Harris Teeter'],
  ['stop & shop', 'Stop & Shop'],
  ['shoprite', 'ShopRite'],
  ["bj's", "BJ's"],
  ['lidl', 'Lidl'],
  ['fresh market', 'The Fresh Market'],
  ['natural grocers', 'Natural Grocers'],
  ['ingles', 'Ingles'],
  ['giant', 'Giant'],
  ['vons', 'Vons'],
  ['ralphs', 'Ralphs'],
]

// ---------------------------------------------------------------------------
// Till shorthand
//
// A receipt writes "GV SHRD MOZZ 8Z" because it has 22 characters to work with.
// Left alone that goes on the shelf verbatim, and a kitchen full of consonants
// is not worth having. The table is deliberately conservative — only shorthand
// with one plausible reading — and is meant to be added to as real receipts
// turn up words it doesn't know.
// ---------------------------------------------------------------------------

const SHORTHAND: Record<string, string> = {
  GV: 'Great Value', MM: 'Marketside', KRO: 'Kroger', SIG: 'Signature',
  ORG: 'Organic', ORGN: 'Organic', NAT: 'Natural',
  SHRD: 'Shredded', SLC: 'Sliced', SLCD: 'Sliced', GRND: 'Ground', CHNK: 'Chunk',
  MOZZ: 'Mozzarella', CHDR: 'Cheddar', CHED: 'Cheddar', CHEDR: 'Cheddar',
  PARM: 'Parmesan', CHS: 'Cheese', CHZ: 'Cheese', CRM: 'Cream', BTR: 'Butter',
  MLK: 'Milk', WHL: 'Whole', YOG: 'Yogurt', YGRT: 'Yogurt', YOGRT: 'Yogurt',
  BNLS: 'Boneless', SKNLS: 'Skinless', BRST: 'Breast', THGH: 'Thigh',
  CHKN: 'Chicken', CHIX: 'Chicken', BF: 'Beef', PRK: 'Pork', TRKY: 'Turkey',
  SSG: 'Sausage', BCN: 'Bacon',
  BRD: 'Bread', WHT: 'Wheat', TORT: 'Tortilla', BGL: 'Bagel', MFN: 'Muffin',
  JC: 'Juice', JCE: 'Juice', SAU: 'Sauce', SAUC: 'Sauce', DRSG: 'Dressing',
  SPAG: 'Spaghetti', PAST: 'Pasta', NDL: 'Noodle', CRKR: 'Cracker',
  CHOC: 'Chocolate', VAN: 'Vanilla', STRW: 'Strawberry', STRWB: 'Strawberry',
  BLBRY: 'Blueberry', RSPBRY: 'Raspberry', BNNA: 'Banana', APL: 'Apple',
  LTC: 'Lettuce', SPNCH: 'Spinach', BROC: 'Broccoli', CRRT: 'Carrot',
  ONN: 'Onion', ONIO: 'Onion', TOM: 'Tomato', PPR: 'Pepper', AVO: 'Avocado',
  CUKE: 'Cucumber', MSHRM: 'Mushroom',
  FRZ: 'Frozen', FRZN: 'Frozen', FZ: 'Frozen',
  YEL: 'Yellow', GRN: 'Green', RD: 'Red', WHTE: 'White', BLK: 'Black',
  LG: 'Large', SM: 'Small', MED: 'Medium', XL: 'Extra Large',
  FF: 'Fat Free', LF: 'Low Fat', RF: 'Reduced Fat', UNSWT: 'Unsweetened',
  SWT: 'Sweet', LTE: 'Light', EVOO: 'Extra Virgin Olive Oil',
  DZ: 'Dozen', CT: 'Count', PK: 'Pack', BX: 'Box', BG: 'Bag', BTL: 'Bottle',
  CN: 'Can', JR: 'Jar', PCH: 'Pouch',
  // Bare unit words, left behind when there is no number for readSize to take:
  // "MM WHL MLK GAL" is a gallon of milk, not a milk gal.
  GAL: 'Gallon', QT: 'Quart', LTR: 'Litre',
  // Seen on real ALDI receipts, which abbreviate mid-word rather than by
  // dropping vowels the way the American chains do.
  SEMISWT: 'Semi-Sweet', MRSLS: 'Morsels', ASSRT: 'Assorted', ASSTD: 'Assorted',
  ORGNC: 'Organic', SHREDS: 'Shredded', RSTD: 'Roasted', SNDWCH: 'Sandwich',
}

/** Size suffixes as a till writes them: "8Z", "64FLOZ", "2LB", "12CT". */
const SIZE_UNITS: Array<[RegExp, Unit]> = [
  [/^(fl\.?oz|floz|fz)$/i, 'floz'],
  [/^(oz|z)$/i, 'oz'],
  [/^(lb|lbs|#)$/i, 'lb'],
  [/^(kg)$/i, 'kg'],
  [/^(g|gm|gr)$/i, 'g'],
  [/^(ml)$/i, 'ml'],
  [/^(l|ltr|lt)$/i, 'l'],
  [/^(gal)$/i, 'gal'],
  [/^(qt)$/i, 'qt'],
  // No 'pt': the app has no pint unit, and quietly recording "1PT" as one cup
  // would halve the amount rather than admit it couldn't read it.
  [/^(ct|pc|pcs|pk|ea)$/i, 'ea'],
]

// ---------------------------------------------------------------------------
// Parsing one line
// ---------------------------------------------------------------------------

/**
 * The money at the end of a line: "2.48", "$ 30.92", "-1.50", "1.50-", "4.89 NC".
 *
 * The trailing letters are a tax code, and they are matched here rather than
 * stripped beforehand because their length varies by chain — Walmart prints one
 * (`F`), ALDI prints two (`NC`, `FA`) — and guessing the alphabet wrongly means
 * no line on the receipt has a price at all, so every item is silently dropped.
 * After a decimal amount the position is unambiguous, so anything short and
 * alphabetic there is a code.
 */
const PRICE_AT_END = /(-)?\$?\s*(\d{1,5}\.\d{2})\s*(-)?(?:\s+[A-Za-z]{1,3})?\s*$/

/**
 * Tax flags — F for food, N/O for non-taxable, T/X for taxed. They trail the
 * price, and on some layouts the barcode as well, so this gets applied twice.
 *
 * An explicit letter set rather than "any one or two capitals": a receipt line
 * can legitimately end in a short word, and stripping blindly turns
 * "MILK VIT D" into "Milk Vit".
 */
const TAX_FLAG = /\s+(?:[FNTXOB]|FT|NT)\s*$/

/** Flags can stack — "… 007874201234 F  2.48 N" has one at each end. */
function stripFlags(text: string): string {
  let out = text
  for (let i = 0; i < 3 && TAX_FLAG.test(out); i++) out = out.replace(TAX_FLAG, '')
  return out.trim()
}

/** "2 @ 1.99", "2 AT $1.99", "1.23 lb @ 2.99" — a quantity and a unit price. */
const AT_PRICE = /(\d+(?:\.\d+)?)\s*(?:([a-z]{1,4})\s*)?(?:@|\bat\b)\s*\$?(\d+(?:\.\d+)?)/i

/**
 * "T O T A L" back into "TOTAL".
 *
 * ALDI letter-spaces its total line for emphasis, which hides it from every
 * pattern that looks for the word — and a hidden total becomes a $30.92 item
 * called "T O T A L". Applied only when deciding what a line *is*, never to a
 * description, where spaced capitals could be somebody's brand.
 */
function collapseSpacedLetters(text: string): string {
  return text.replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (run) => run.replace(/\s+/g, ''))
}

function isNoise(line: string): boolean {
  const flat = collapseSpacedLetters(line)
  return NOISE.some((p) => p.test(line) || p.test(flat))
}

/**
 * The lengths a real barcode actually comes in: EAN-8/UPC-E is 8, UPC-A is 12,
 * EAN-13 is 13, ITF-14 is 14.
 *
 * Matched exactly rather than as "8 or more", because a store's own item number
 * is frequently 9 or 10 digits and looks like a barcode until it is sent to
 * Open Food Facts, which answers confidently about an entirely different
 * product. A number that is not one of these lengths is a till code.
 */
const BARCODE_LENGTHS = new Set([8, 12, 13, 14])

/** Pulls a barcode out of what is left after the price is removed. */
function findBarcode(text: string): { barcode?: string; rest: string } {
  const runs = [...text.matchAll(/\d{6,20}/g)].filter((r) => BARCODE_LENGTHS.has(r[0].length))
  if (!runs.length) return { rest: text }

  // The last of the longest: the code usually trails the description.
  let best = runs[0]
  for (const run of runs) {
    if (run[0].length >= best[0].length) best = run
  }

  const rest = text.slice(0, best.index) + ' ' + text.slice(best.index! + best[0].length)
  return { barcode: best[0], rest }
}

/**
 * The till's own item number, which most chains print before the description.
 *
 * Taken only from the front of the line and only once the barcode is gone, so
 * what is left can be read plainly: a long number at the start of a purchase
 * line is a code, because no product is named after one.
 *
 * Worth keeping even though it means nothing to Open Food Facts. It is stable
 * per product — that tub of hummus is 343825 every week — so the catalogue can
 * hang a scanned barcode off it once and answer for every later receipt.
 */
function findStoreCode(text: string): { sku?: string; rest: string } {
  const match = text.match(/^\s*(\d{4,13})(?=\s|$)/)
  if (!match) return { rest: text }
  return { sku: match[1], rest: text.slice(match[0].length) }
}

/**
 * "MOZZ 8Z" → 8 oz. Reads a size off the tail of a description and removes it,
 * so the name is a name and the amount lives in the fields built for it.
 */
function readSize(text: string): { size?: number; sizeUnit?: Unit; rest: string } {
  const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*-?\s*([a-z#]{1,5})\s*$/i)
  if (!match) return { rest: text }
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return { rest: text }
  for (const [pattern, unit] of SIZE_UNITS) {
    if (pattern.test(match[2])) {
      return { size: value, sizeUnit: unit, rest: text.slice(0, match.index).trim() }
    }
  }
  return { rest: text }
}

/**
 * Till shorthand out, ordinary words in.
 *
 * A receipt that already prints mixed case has done the casing work itself, so
 * only the shorthand is substituted — re-casing ALDI's "CA Heritage Brut" would
 * demote the state to "Ca". A receipt shouting in capitals gets title-cased,
 * because "GV SHRD MOZZ" is nobody's idea of a shelf label.
 */
export function expandDescription(raw: string): string {
  const shouting = raw === raw.toUpperCase()
  const words = raw
    .replace(/[^A-Za-z0-9'&.\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const bare = word.replace(/[^A-Za-z0-9']/g, '')
      const known = SHORTHAND[bare.toUpperCase()]
      if (known) return known
      // A bare number left in the middle of a name is a code fragment, not a word.
      if (/^\d+$/.test(bare)) return ''
      if (!shouting) return bare
      return bare.toLowerCase().replace(/^[a-z]/, (c) => c.toUpperCase())
    })
    .filter(Boolean)

  return words.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * One line of a receipt into a structured line, or null if it is furniture.
 *
 * The order matters: the price is stripped from the end first, then the
 * barcode, and whatever survives is the description. Doing it the other way
 * round lets a price's digits be mistaken for a product code.
 */
export function parseLine(raw: string, index: number): ReceiptLine | null {
  const line = raw.trim()
  if (!line) return null

  const flagged = stripFlags(line)
  const priceMatch = flagged.match(PRICE_AT_END)
  if (!priceMatch) return null // no money on it, so it is not a purchase

  const negative = Boolean(priceMatch[1] || priceMatch[3])
  const price = Number(priceMatch[2]) * (negative ? -1 : 1)
  let work = flagged.slice(0, priceMatch.index).trim()

  // Checked only now: a noise word on a line with no price was already gone,
  // and this way "TOTAL CEREAL 004112 3.98" survives as the cereal it is.
  if (isNoise(line) && !/\d{8,14}/.test(work)) return null

  let qty = 1
  let unit: Unit | undefined
  // Read against the line *including* its price. On a bare "3 @ 0.39" the unit
  // price is the price at the end of the line, so searching only what survives
  // the price strip leaves "3 @" and the quantity is silently lost.
  const at = flagged.match(AT_PRICE)
  if (at) {
    const count = Number(at[1])
    if (Number.isFinite(count) && count > 0) qty = count
    unit = measureUnit(at[2])
  }
  // Take the amount clause out of the description either way — whole when it
  // survived the strip, and as a dangling "3 @" when it did not.
  work = work
    .replace(AT_PRICE, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*[a-z]{0,4}\s*(?:@|\bat\b)\s*$/i, ' ')
    .trim()

  const { barcode, rest } = findBarcode(work)
  // The flag that sat between the description and the barcode is only reachable
  // now that the digits are gone.
  return buildLine({ raw: line, index, barcode, text: stripFlags(rest), qty, unit, price })
}

/**
 * The unit in "2.14 lb @ 0.59/lb", when there is one.
 *
 * Only measures — a count word like "ct" beside an @ price means a pack size,
 * not the unit the line is sold in, and recording "12 ct" as a quantity of 12
 * would turn one box of eggs into twelve.
 */
function measureUnit(word: string | undefined): Unit | undefined {
  if (!word) return undefined
  for (const [pattern, unit] of SIZE_UNITS) {
    if (pattern.test(word)) return unit === 'ea' ? undefined : unit
  }
  return undefined
}

/**
 * The half of line-building that both input routes share.
 *
 * A pasted line has to be taken apart first; a photographed one arrives already
 * in pieces. From here on they are the same thing, which is the point — one
 * screen reviews both, and a bug in the naming shows up in both at once rather
 * than in whichever one nobody tested.
 */
function buildLine(parts: {
  raw: string
  index: number
  barcode?: string
  text: string
  qty: number
  unit?: Unit
  price: number
}): ReceiptLine {
  const { sku, rest: unnumbered } = findStoreCode(parts.text)
  const { size, sizeUnit, rest } = readSize(unnumbered)
  const rawDescription = rest.replace(/\s+/g, ' ').trim()
  const description = expandDescription(rawDescription)
  const kind: LineKind = parts.price < 0 ? 'discount' : 'item'
  const barcode = parts.barcode?.replace(/\D/g, '') || undefined

  return {
    key: `l${parts.index}`,
    raw: parts.raw,
    kind,
    barcode,
    sku,
    // Nothing but a price and a code. Kept — the lookup may still name it — but
    // it needs something on screen that is not a blank row.
    description:
      description ||
      (kind === 'discount'
        ? 'Discount'
        : barcode || sku
          ? `Item ${(barcode ?? sku)!.slice(-4)}`
          : 'Unnamed line'),
    rawDescription: rawDescription || parts.raw,
    qty: parts.qty,
    unit: parts.unit ?? 'ea',
    price: Math.round(parts.price * 100) / 100,
    size,
    sizeUnit,
    include: kind === 'item',
  }
}

// ---------------------------------------------------------------------------
// Parsing the whole thing
// ---------------------------------------------------------------------------

/** MM/DD/YY(YY), DD/MM when the first number cannot be a month, or ISO. */
function findDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const slash = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/)
  if (slash) {
    let [, a, b, y] = slash
    // US receipts write MM/DD; a first number above 12 can only be a day.
    const [month, day] = Number(a) > 12 ? [b, a] : [a, b]
    const year = y.length === 2 ? `20${y}` : y
    const mm = month.padStart(2, '0')
    const dd = day.padStart(2, '0')
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${year}-${mm}-${dd}`
    }
  }
  return undefined
}

function findStore(lines: string[]): string | undefined {
  const head = lines.slice(0, 8)
  for (const line of head) {
    const lower = line.toLowerCase()
    const chain = CHAINS.find(([needle]) => lower.includes(needle))
    if (chain) return chain[1]
  }
  // No chain we know. The first line that reads like a name rather than an
  // address, a phone number or a rule of dashes.
  for (const line of head) {
    const clean = line.trim()
    if (clean.length < 3 || clean.length > 40) continue
    if (/\d{3}/.test(clean) || isNoise(clean)) continue
    if (!/[A-Za-z]{3}/.test(clean)) continue
    return expandDescription(clean)
  }
  return undefined
}

/** The printed total, preferring the last "TOTAL" that is not a subtotal. */
function findPrintedTotal(lines: string[]): number | undefined {
  let found: number | undefined
  for (const line of lines) {
    const flat = collapseSpacedLetters(line)
    if (!/\btotal\b/i.test(flat)) continue
    if (/sub\s*-?\s*total/i.test(flat)) continue
    const match = stripFlags(line).match(PRICE_AT_END)
    if (match) found = Number(match[2])
  }
  return found
}

/**
 * A row carrying only an amount — "2 @ 1.99", "2.14 lb @ 0.59/lb" — with no
 * description and no code of its own. It belongs to a neighbouring row.
 */
function isContinuation(line: ReceiptLine): boolean {
  if (line.barcode || !AT_PRICE.test(line.raw)) return false
  return line.rawDescription.replace(/[^A-Za-z]/g, '').length < 3
}

/** A row that reads like a product name but carries no price of its own. */
function isBareName(row: string): boolean {
  return !isNoise(row) && /[A-Za-z]{3}/.test(row) && !/\d{3,}/.test(row)
}

export function parseReceipt(text: string): ParsedReceipt {
  const rows = text.split(/\r?\n/)
  const lines: ReceiptLine[] = []
  /** Source row each accepted line came from, so adjacency can be checked. */
  const sourceRow: number[] = []
  let ignored = 0

  // Held between rows, because plenty of receipts split one purchase over two:
  // the name on one line and "2.14 lb @ $0.59/lb   1.26" on the next.
  let pendingName = ''
  let pendingRow = -1

  rows.forEach((row, i) => {
    const trimmed = row.trim()
    if (!trimmed) return

    const line = parseLine(row, i)

    if (!line) {
      // No money on it. Either the first half of a two-line entry, or furniture.
      if (isBareName(trimmed)) {
        pendingName = trimmed
        pendingRow = i
      } else {
        ignored++
      }
      return
    }

    if (isContinuation(line)) {
      // The name came first, on the row immediately above.
      if (pendingName && pendingRow === i - 1) {
        lines.push(buildLine({
          raw: `${pendingName}  ${trimmed}`,
          index: pendingRow,
          text: pendingName,
          qty: line.qty,
          unit: line.unit === 'ea' ? undefined : line.unit,
          price: line.price ?? 0,
        }))
        sourceRow.push(i)
        pendingName = ''
        return
      }
      // Otherwise it qualifies the priced line directly above it. Checked by
      // source row rather than "the last line we kept": without that, an amount
      // line following a dropped row silently rewrites the quantity of some
      // earlier item, which is how 2.14 lb of bananas became 2.14 gallons of milk.
      if (lines.length && sourceRow[sourceRow.length - 1] === i - 1) {
        const prev = lines[lines.length - 1]
        lines[lines.length - 1] = {
          ...prev,
          qty: line.qty,
          unit: line.unit === 'ea' ? prev.unit : line.unit,
        }
        ignored++
        return
      }
    }

    lines.push(line)
    sourceRow.push(i)
    pendingName = ''
  })

  return {
    store: findStore(rows),
    date: findDate(text),
    lines: foldRepeats(lines),
    printedTotal: findPrintedTotal(rows),
    ignored,
  }
}

/**
 * Two rows of the same thing at the same price become one row of two.
 *
 * A till prints a line per scan, so buying two identical salamis prints two
 * identical lines — and importing them literally puts two rows called "Cocktail
 * Salami" on the shelf, which is not how anyone thinks about their own
 * cupboard. Same behaviour as the rapid scanner, and just as reversible: the
 * quantity is a stepper on the review screen.
 *
 * Matched on the till's own text and the unit price, never on the expanded
 * name — two different products can expand to the same words, and folding
 * those together would quietly lose one.
 */
function foldRepeats(lines: ReceiptLine[]): ReceiptLine[] {
  const out: ReceiptLine[] = []
  const each = (l: ReceiptLine) => Math.round(((l.price ?? 0) / (l.qty || 1)) * 100) / 100

  for (const line of lines) {
    const twin = line.kind === 'item'
      ? out.find((f) =>
          f.kind === 'item' &&
          f.sku === line.sku &&
          f.rawDescription === line.rawDescription &&
          f.unit === line.unit &&
          each(f) === each(line))
      : undefined

    if (twin) {
      twin.qty += line.qty
      twin.price = Math.round(((twin.price ?? 0) + (line.price ?? 0)) * 100) / 100
      continue
    }
    out.push({ ...line })
  }
  return out
}

/** What the lines add up to, discounts included. */
export function computedTotal(lines: ReceiptLine[]): number {
  const sum = lines
    .filter((l) => l.include || l.kind === 'discount')
    .reduce((n, l) => n + (l.price ?? 0), 0)
  return Math.round(sum * 100) / 100
}

// ---------------------------------------------------------------------------
// The photographed route
// ---------------------------------------------------------------------------

/**
 * A receipt transcribed from a photograph rather than pasted.
 *
 * Structural rather than imported from lib/ai.ts on purpose: this module stays
 * free of the API client, so the parser can still be run over a string in
 * isolation.
 */
export interface ScannedReceipt {
  store?: string
  date?: string
  printedTotal?: number
  lines: Array<{ barcode?: string; description: string; qty: number; price: number }>
}

/**
 * A transcribed line puts its code in `barcode` because the model cannot tell
 * a UPC from a till number by looking. Length decides: anything that is not a
 * real barcode length is treated as the shop's own code and rejoined to the
 * front of the description, where `findStoreCode` will pick it up.
 */
function codeIntoText(code: string | undefined, text: string): string {
  const clean = code?.replace(/\D/g, '') ?? ''
  if (!clean || BARCODE_LENGTHS.has(clean.length)) return text
  return `${clean} ${text}`
}

/** Transcribed rows into the same reviewed shape a pasted receipt produces. */
export function receiptFromScan(scan: ScannedReceipt): ParsedReceipt {
  const lines = scan.lines
    .filter((l) => l.description?.trim() || l.barcode)
    .map((l, i) =>
      buildLine({
        raw: [l.barcode, l.description, l.price?.toFixed(2)].filter(Boolean).join('  '),
        index: i,
        barcode: BARCODE_LENGTHS.has((l.barcode ?? '').replace(/\D/g, '').length)
          ? l.barcode
          : undefined,
        text: codeIntoText(l.barcode, stripFlags(l.description ?? '')),
        qty: Number.isFinite(l.qty) && l.qty > 0 ? l.qty : 1,
        price: Number.isFinite(l.price) ? l.price : 0,
      }),
    )

  return {
    store: scan.store?.trim() || undefined,
    date: scan.date?.trim() || undefined,
    lines,
    printedTotal: scan.printedTotal ? scan.printedTotal : undefined,
    ignored: 0,
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** What a barcode lookup adds to a line once it comes back. */
export interface LineLookup {
  name?: string
  brand?: string
  category?: Category
  nutrition?: Nutrition
  size?: number
  sizeUnit?: Unit
}

/**
 * Folds a finished lookup into its line.
 *
 * Open Food Facts wins on the name when it has one — "Shredded Mozzarella
 * Cheese" beats a guess at what MOZZ meant — but never on price or quantity,
 * which only the receipt knows.
 */
export function applyLineLookup(
  lines: ReceiptLine[],
  barcode: string,
  found: LineLookup | null,
): ReceiptLine[] {
  if (!found?.name) return lines
  return lines.map((l) =>
    l.barcode !== barcode
      ? l
      : {
          ...l,
          description: found.name!,
          size: l.size ?? found.size,
          sizeUnit: l.sizeUnit ?? found.sizeUnit,
        },
  )
}

export function setLineQty(lines: ReceiptLine[], key: string, qty: number): ReceiptLine[] {
  return lines.map((l) => (l.key === key ? { ...l, qty: Math.max(0, qty) } : l))
}

export function setLineField(
  lines: ReceiptLine[],
  key: string,
  patch: Partial<ReceiptLine>,
): ReceiptLine[] {
  return lines.map((l) => (l.key === key ? { ...l, ...patch } : l))
}

// ---------------------------------------------------------------------------
// Writing it away
// ---------------------------------------------------------------------------

export interface CommitReceiptInput {
  store: string
  date: string
  printedTotal?: number
  note?: string
  /** Per-barcode extras gathered by the screen while lookups came back. */
  lookups?: Record<string, LineLookup>
}

export interface ReceiptResult {
  tripId: number
  /** Lines that went straight onto the shelf, already known. */
  added: number
  /** Lines parked in Unpack because their product has never been scanned. */
  parked: number
}

/**
 * Turns the reviewed lines into stock, all of it stamped with one trip.
 *
 * Every line is looked up in the product catalogue first, by barcode where the
 * receipt printed one and by till code otherwise. What happens next depends on
 * whether this household has met the product before:
 *
 *   * **Known** — straight onto the shelf, wearing the catalogue's name rather
 *     than the till's abbreviation, with its brand and nutrition attached.
 *   * **New** — a catalogue entry is created and the line waits in Unpack for
 *     its one-time barcode scan. Scanning it there teaches the catalogue, and
 *     every later receipt carrying that code skips this branch entirely.
 *
 * So the first ALDI import asks about everything and the tenth asks about
 * whatever was new that week, which is the point of the whole arrangement.
 *
 * Not a transaction. `db.transaction()` cannot be one against PostgREST, so a
 * failure part-way leaves the trip and the rows written so far. The trip is
 * created first on purpose: items with a trip that is missing its rows read as
 * an incomplete import, where rows with no trip read as nothing at all.
 */
export async function commitReceipt(
  lines: ReceiptLine[],
  input: CommitReceiptInput,
): Promise<ReceiptResult | null> {
  const buying = lines.filter((l) => l.include && l.kind === 'item' && l.qty > 0)
  if (!buying.length) return null

  const places = await db.places.toArray()
  const lookups = input.lookups ?? {}
  const total = computedTotal(lines)

  const trip: Omit<Trip, 'id'> = {
    date: input.date || todayISO(),
    store: input.store.trim() || 'Groceries',
    total,
    itemCount: buying.reduce((n, l) => n + l.qty, 0),
    source: 'receipt',
    printedTotal: input.printedTotal,
    note: input.note,
  }
  const tripId = await db.trips.add(trip)

  let added = 0
  let parked = 0

  for (const line of buying) {
    const found = line.barcode ? lookups[line.barcode] : undefined

    // The catalogue entry, created here if this is the first sighting. Named
    // from the lookup when there was one, and from the till otherwise.
    const product = await upsertProduct({
      name: (found?.name ?? line.description).trim(),
      brand: found?.brand,
      barcode: line.barcode,
      store: input.store,
      sku: line.sku,
      category: found?.category,
      unit: line.unit,
      size: line.size ?? found?.size,
      sizeUnit: line.sizeUnit ?? found?.sizeUnit,
      nutrition: found?.nutrition,
    })

    // No barcode on the catalogue entry means nobody has ever scanned the
    // packet, so nothing here knows what it really is beyond a till
    // abbreviation. It waits in Unpack for that one scan rather than going on
    // the shelf under a name nobody chose.
    if (!product.barcode) {
      const row: Omit<InboxItem, 'id'> = {
        name: product.name,
        brand: product.brand,
        category: product.category,
        qty: line.qty,
        unit: line.unit,
        scanned: false,
        productId: product.id,
        sku: line.sku,
        store: input.store,
        price: line.price,
        tripId,
        guessSource: 'manual',
        guessNote: line.sku
          ? `From the receipt — scan the packet once and every ${input.store || 'shop'} receipt will know it`
          : 'From the receipt — scan the packet to identify it',
        createdAt: new Date().toISOString(),
      }
      await db.inbox.add(row)
      parked++
      continue
    }

    const category = product.category
    const location = suggestPlace(places, category)

    await addItem({
      name: product.name,
      category,
      location,
      qty: line.qty,
      qtyInitial: line.qty,
      unit: line.unit,
      size: line.size ?? product.size,
      sizeUnit: line.sizeUnit ?? product.sizeUnit,
      // The receipt's figure is for the whole line, which is exactly what
      // `price` means — unitPrice() divides by qtyInitial when it needs to.
      price: line.price,
      purchasedAt: trip.date,
      expiresAt: suggestExpiry(places, category, location),
      isStaple: false,
      archived: false,
      barcode: product.barcode,
      brand: product.brand,
      nutrition: product.nutrition,
      foodKey: product.foodKey,
      productId: product.id,
      tripId,
    })
    if (product.id != null) {
      await recordPurchase(product.id, { price: line.price, date: trip.date, qty: line.qty })
    }
    added++
  }

  return { tripId, added, parked }
}
