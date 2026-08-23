import { computedTotal, expandDescription, parseReceipt, receiptFromScan } from './receipt'

/**
 * Fixtures for the receipt parser. Run with `npm run test:receipt`.
 *
 * Kept in the repo rather than thrown away, unlike the rapid.ts tests before
 * them, because this is the one piece of the app that has to cope with input
 * nobody controls. Every chain lays its receipt out differently, so the answer
 * to "it read my receipt wrong" is to paste it in here as a new case, watch it
 * fail, and fix the parser — which only works if the other five still pass.
 *
 * No test framework: the parser is pure, so a file of assertions and a non-zero
 * exit code is the whole requirement, and a dependency would be the larger part
 * of the change.
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

// ---------------------------------------------------------------------------

describe('Walmart — description, UPC, tax flags either side of the price', () => {
  const r = parseReceipt(`
Walmart
Save money. Live better.
( 555 ) 123-4567
ST# 01234 OP# 009876 TE# 12 TR# 05432

GV SHRD MOZZ 8Z    007874201234 F         2.48 N
BANANAS            000000004011 F         1.19 F
  3 @ 0.39
COCA COLA 12PK     004900002890 T         6.98 T
TOTAL CEREAL 12Z   001600042110 F         4.29 N
COUPON 1234                              -1.50 N
SUBTOTAL                                 15.44
TAX 1                    7.000 %          0.49
TOTAL                                    15.93
VISA TEND                                15.93
08/14/26      14:32:07
`)

  check('store', r.store, 'Walmart')
  check('date', r.date, '2026-08-14')
  check('printed total', r.printedTotal, 15.93)
  check('line count', r.lines.length, 5)
  check('names', r.lines.map((l) => l.description), [
    'Great Value Shredded Mozzarella',
    'Bananas',
    'Coca Cola',
    'Total Cereal',
    'Coupon',
  ])
  // The amount line below Bananas raises that line, and does not leak upward.
  check('quantities', r.lines.map((l) => l.qty), [1, 3, 1, 1, 1])
  check('pack size off the name', r.lines[0].size, 8)
  check('pack size unit', r.lines[0].sizeUnit, 'oz')
  // "TOTAL CEREAL" is a product; "TOTAL" and "SUBTOTAL" are not.
  check('a product named TOTAL survives', r.lines[3].description, 'Total Cereal')
  check('discount is not stocked', r.lines[4].include, false)
  check('computed total', computedTotal(r.lines), 13.44)
})

describe('Kroger — a name on one line, the weight on the next', () => {
  const r = parseReceipt(`
KROGER
1 GALLON MILK        0001111041660    3.49 F
BANANAS
   2.14 lb @ $0.59/lb                 1.26 F
GV SHRD CHDR 8Z      0007874209988    2.18 F
TOTAL                                 6.93
`)

  check('line count', r.lines.length, 3)
  check('names', r.lines.map((l) => l.description), [
    'Gallon Milk',
    'Bananas',
    'Great Value Shredded Cheddar',
  ])
  // The regression this guards: the weight line used to attach to the milk.
  check('milk is one unit', r.lines[0].qty, 1)
  check('bananas carry their weight', r.lines[1].qty, 2.14)
  check('sold by the pound', r.lines[1].unit, 'lb')
  check('bananas price is the line total', r.lines[1].price, 1.26)
})

describe('Costco — a decorated total, and a coupon against an item number', () => {
  const r = parseReceipt(`
COSTCO WHOLESALE
Member 111222333444

1204135 ORG SPINACH        5.99 N
980183 KS OLIVE OIL       18.99 N
  1204135  /5.00-
SUBTOTAL                  24.98
TAX                        1.20
**** TOTAL                21.18
09/02/26
`)

  check('store', r.store, 'Costco')
  check('"**** TOTAL" is not an item', r.lines.map((l) => l.kind), ['item', 'item', 'discount'])
  check('printed total', r.printedTotal, 21.18)
  check('trailing minus reads as a discount', r.lines[2].price, -5)
  check('computed total', computedTotal(r.lines), 19.98)
})

describe("Sam's Club — an apostrophe in the chain name", () => {
  const r = parseReceipt(`
SAM'S CLUB
980183526 GV WHL MILK      3.28 N
193847261 ROTISSERIE CHKN  4.98 N
TOTAL                      8.26
`)

  check('store', r.store, "Sam's Club")
  check('names', r.lines.map((l) => l.description), ['Great Value Whole Milk', 'Rotisserie Chicken'])
})

describe('Target — short item codes are not barcodes', () => {
  const r = parseReceipt(`
TARGET
215708 BANANAS                  1.19
017781 MM WHL MLK GAL           3.49
SUBTOTAL                        4.68
T = TX 7.0000% on 3.49          0.24
TOTAL                           4.92
*1234 VISA CHARGE               4.92
`)

  check('store', r.store, 'Target')
  // A tax-rate line and a card line are furniture, however they are worded.
  check('line count', r.lines.length, 2)
  check('names', r.lines.map((l) => l.description), ['Bananas', 'Marketside Whole Milk Gallon'])
  // Six digits is a store code, not a UPC — sending it to Open Food Facts
  // would return a confident answer about the wrong product.
  check('no barcode claimed', r.lines.map((l) => l.barcode), [undefined, undefined])
})

describe('A photographed receipt lands in the same shape', () => {
  const r = receiptFromScan({
    store: 'Publix',
    date: '2026-08-20',
    printedTotal: 5.65,
    lines: [
      { barcode: '0007874201234', description: 'GV SHRD MOZZ 8Z', qty: 2, price: 4.96 },
      { description: 'BANANAS', qty: 1, price: 1.19 },
      { description: 'COUPON', qty: 1, price: -0.5 },
    ],
  })

  check('store', r.store, 'Publix')
  check('names expand the same way', r.lines.map((l) => l.description), [
    'Great Value Shredded Mozzarella',
    'Bananas',
    'Coupon',
  ])
  check('quantity survives', r.lines[0].qty, 2)
  check('pack size read from the till text', r.lines[0].sizeUnit, 'oz')
  check('negative price is a discount', r.lines[2].kind, 'discount')
  check('computed total', computedTotal(r.lines), 5.65)
})

describe('Till shorthand', () => {
  check('brand and cut', expandDescription('CHKN BRST BNLS'), 'Chicken Breast Boneless')
  check('bare unit words', expandDescription('MM WHL MLK GAL'), 'Marketside Whole Milk Gallon')
  check('unknown words are title-cased', expandDescription('RANDOM THING'), 'Random Thing')
  check('stray code fragments drop out', expandDescription('SPINACH 0012'), 'Spinach')
})

// ---------------------------------------------------------------------------

console.log(
  failures
    ? `\n${failures} of ${checks} checks failed\n`
    : `\nAll ${checks} checks passed\n`,
)
process.exit(failures ? 1 : 0)
