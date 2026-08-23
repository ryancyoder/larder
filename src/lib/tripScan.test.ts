import { advance, matchScan, nameScore, progress, type PendingRow } from './tripScan'

/**
 * Matching logic for the trip scan session. Run with `npm run test:tripscan`.
 *
 * The names here are real ones off a 73-line ALDI import, because the whole
 * question is whether an Open Food Facts name can be recognised as the same
 * product a till abbreviated into 18 characters.
 */

let failures = 0
let checks = 0

function check(label: string, actual: unknown, expected: unknown): void {
  checks++
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.error(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`)
  }
}

function describe(name: string, run: () => void): void {
  console.log(`\n${name}`)
  run()
}

const ROWS: PendingRow[] = [
  { id: 1, name: 'Assorted Hummus', sku: '343827', price: 2.59, qty: 1 },
  { id: 2, name: 'FrzFineGreenBeans', sku: '464716', price: 2.59, qty: 1 },
  { id: 3, name: 'Aged White Cheddar', sku: '382321', price: 2.69, qty: 1 },
  { id: 4, name: 'Chicken Pot Pie', sku: '365403', price: 0.99, qty: 2 },
]

describe('Recognising a till abbreviation in a real product name', () => {
  // Token overlap, not edit distance: these share every word and almost no
  // character positions.
  check('run-together words still match', nameScore('Fine Green Beans, Frozen', 'FrzFineGreenBeans') > 0.6, true)
  check('a plain match', nameScore('Aged White Cheddar Cheese', 'Aged White Cheddar') > 0.6, true)
  check('unrelated products do not', nameScore('Sparkling Water', 'Chicken Pot Pie') < 0.3, true)
  check('an empty name scores nothing', nameScore('', 'Assorted Hummus'), 0)
})

describe('A scan claims the row it belongs to', () => {
  const cursor = ROWS[0]

  // The ordinary case: no useful name back, so the cursor decides.
  const obeyed = matchScan(ROWS, cursor, undefined)
  check('unknown barcode takes the current row', obeyed?.row.id, 1)
  check('and says so', obeyed?.reason, 'current')

  // The useful case: you grabbed something out of order and the lookup knows
  // what it is, so the packet in your hand outranks the cursor.
  const moved = matchScan(ROWS, cursor, 'Aged White Cheddar Cheese')
  check('a recognised name finds its own line', moved?.row.id, 3)
  check('and says it guessed', moved?.reason, 'name')

  // A name that matches nothing must not be forced onto a random row.
  const weak = matchScan(ROWS, cursor, 'Sparkling Water 12pk')
  check('a poor match falls back to the cursor', weak?.row.id, 1)
  check('rather than guessing', weak?.reason, 'current')

  check('nothing pending, nothing claimed', matchScan([], cursor, 'Hummus'), null)
})

describe('Working down the list', () => {
  check('starts at the top', advance(ROWS, new Set())?.id, 1)
  check('moves past the one just done', advance(ROWS, new Set([1]), 1)?.id, 2)
  // Skipped rows are not lost — the cursor wraps back for them at the end.
  check('wraps back for a skipped row', advance(ROWS, new Set([2, 3, 4]), 4)?.id, 1)
  check('undefined when everything is done', advance(ROWS, new Set([1, 2, 3, 4]), 4), undefined)
})

describe('Progress', () => {
  const p = progress(ROWS, new Set([1, 3]))
  check('counted', [p.done, p.total], [2, 4])
  // What has been put away, in money — the receipt knew the prices all along.
  check('and priced', p.spent, 5.28)
})

console.log(failures ? `\n${failures} of ${checks} checks failed\n` : `\nAll ${checks} checks passed\n`)
process.exit(failures ? 1 : 0)
