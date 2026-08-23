import { computedTotal, expandDescription, parseReceipt, receiptFromScan } from './receipt'
import { comparePrice, lastPaidByProduct } from './products'

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

/**
 * A real ALDI receipt, transcribed from the paper — and the reference case,
 * because almost every receipt this household imports comes from there.
 *
 * It broke five assumptions at once when it first went through, and between
 * them they dropped every single item on it:
 *
 *   - the tax code after the price is two letters ("NC", "FA"), not one, so no
 *     line matched a price at all and all eight were silently discarded
 *   - the total is letter-spaced, "T O T A L", which hid it from the word
 *     `total` and turned it into a $30.92 item
 *   - "AMOUNT DUE" and "8 ITEMS" are furniture with prices on them
 *   - "C-Taxable @7.000%" is not matched by \btax\b
 *   - the till prints mixed case, so the title-caser demoted "CA" to "Ca"
 *
 * Its item codes are six digits — ALDI's own numbering, not UPCs. Nothing on
 * an ALDI receipt will ever resolve against Open Food Facts, which makes the
 * description the entire name and this fixture the one that matters most.
 */
describe('ALDI — the real thing', () => {
  const r = parseReceipt(`ALDI
Store #37
2906 LaPorte Avenue
Valparaiso, IN
https://help.aldi.us
Your cashier today was Stephanie

  514025 CA Heritage Brut          4.89 NC
  638449 Maguires Stout            7.69 NC
  356525 Carrots                   1.99 FA
  343825 Assorted Hummus           2.59 FA
  654779 Cocktail Salami           2.99 FA
  654779 Cocktail Salami           2.99 FA
  679181 Avocado Oil Chips         2.99 FA
  383466 SemiSwt Mini Mrsls        3.65 NC
Mastercard                        30.92
***************0242 ONLINE
08/15/26 18:05 Ref/Seq # 422779
Trace # 422779
Auth # 56302P
AID A00000000041010
TVR 0000001000
IAD 0110606001622000DE9F000000003092
OOFF
TSI E800    ARC 00    EntryMode 05
        ++APPROVED++

SUBTOTAL                          29.78
C-Taxable @7.000%                  1.14
A-Taxable @0.00%                   0.00
AMOUNT DUE                        30.92
T O T A L        $ 30.92
8 ITEMS
Credit Card                     $ 30.92

*6425 F594/005/005 08/15/26 06:05PM`)

  check('store', r.store, 'ALDI')
  check('date', r.date, '2026-08-15')
  check('the letter-spaced total is found', r.printedTotal, 30.92)
  // Eight items on the paper, seven rows: the two salamis fold into one.
  check('row count', r.lines.length, 7)
  check('names', r.lines.map((l) => l.description), [
    'CA Heritage Brut',
    'Maguires Stout',
    'Carrots',
    'Assorted Hummus',
    'Cocktail Salami',
    'Avocado Oil Chips',
    'Semi-Sweet Mini Morsels',
  ])
  check('a repeat becomes a quantity', r.lines[4].qty, 2)
  check('and its prices add up', r.lines[4].price, 5.98)
  // The till's own wording is kept beside the name, so a mis-expansion can be
  // checked against the paper on the review screen.
  check('raw text kept', r.lines[4].rawDescription, 'Cocktail Salami')
  // Six digits is ALDI's item number, and it is captured as one. Claiming it
  // as a barcode would send it to Open Food Facts and get a confident answer
  // about an entirely different product.
  check('no barcodes claimed', r.lines.every((l) => l.barcode === undefined), true)
  check('item numbers captured', r.lines.map((l) => l.sku), [
    '514025', '638449', '356525', '343825', '654779', '679181', '383466',
  ])
  check('mixed case is left alone', r.lines[0].description, 'CA Heritage Brut')
  // Matches the SUBTOTAL printed on the receipt; the gap to TOTAL is the
  // C-Taxable line, which is exactly what the review screen reports.
  check('computed total', computedTotal(r.lines), 29.78)
  check('everything is tax', Math.round((r.printedTotal! - computedTotal(r.lines)) * 100) / 100, 1.14)
})

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
  check('a real 12-digit UPC still reads as one', r.lines[0].barcode, '007874201234')
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
    'Milk',
    'Bananas',
    'Great Value Shredded Cheddar',
  ])
  // A size written at the front belongs in the size fields, not the name.
  // Dropping the number and stranding the unit is what produced a real shelf
  // full of "oz Pasta Sauce".
  check('leading size is read', [r.lines[0].size, r.lines[0].sizeUnit], [1, 'gal'])
  // The regression this guards: the weight line used to attach to the milk.
  check('milk is one unit', r.lines[0].qty, 1)
  check('bananas carry their weight', r.lines[1].qty, 2.14)
  check('sold by the pound', r.lines[1].unit, 'lb')
  check('bananas price is the line total', r.lines[1].price, 1.26)
})

describe('Regressions from a real 73-line ALDI import', () => {
  const r = parseReceipt(`ALDI
  385110 24 oz Pasta Sauce        1.69 FA
  385110 24 oz Pasta Sauce        1.69 FA
  365403 Chicken Pot Pie          0.99 FA
  365403 Chicken Pot Pie          0.99 FA
  399568 1lb Ham Lunchmeat        5.89 FA
  383041 Large Organic ACV        4.99 NC
TOTAL                            16.24
`)

  // Was "oz Pasta Sauce": the 24 was discarded as a code fragment and the unit
  // left stranded on the front of the name.
  check('leading size leaves the name', r.lines[0].description, 'Pasta Sauce')
  check('and lands in the size fields', [r.lines[0].size, r.lines[0].sizeUnit], [24, 'oz'])
  check('no space needed', r.lines[2].description, 'Ham Lunchmeat')
  check('unspaced size read too', [r.lines[2].size, r.lines[2].sizeUnit], [1, 'lb'])
  // Four rows on the paper, two on the shelf.
  check('repeats fold', r.lines.length, 4)
  check('as quantities', r.lines.map((l) => l.qty), [2, 2, 1, 1])
  check('with prices summed', r.lines[0].price, 3.38)
  // A name with no size is left entirely alone.
  check('untouched', r.lines[3].description, 'Large Organic ACV')
})

describe('A photographed receipt folds repeats like a pasted one', () => {
  // The bug this guards: receiptFromScan skipped foldRepeats, so the same shop
  // imported differently depending on whether it was pasted or photographed.
  const r = receiptFromScan({
    store: 'ALDI',
    lines: [
      { barcode: '365403', description: 'Chicken Pot Pie', qty: 1, price: 0.99 },
      { barcode: '365403', description: 'Chicken Pot Pie', qty: 1, price: 0.99 },
    ],
  })
  check('one row', r.lines.length, 1)
  check('of two', r.lines[0].qty, 2)
  check('priced together', r.lines[0].price, 1.98)
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
  // Nine digits is no barcode length there is, so it is the club's own number.
  check('nine digits is a till code', r.lines.map((l) => l.sku), ['980183526', '193847261'])
  check('and not a barcode', r.lines.map((l) => l.barcode), [undefined, undefined])
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
  check('captured as till codes instead', r.lines.map((l) => l.sku), ['215708', '017781'])
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

describe('Comparing what a thing cost last time', () => {
  // Per unit, always. Two jars at $5.18 and one at $2.59 are the same price,
  // and a comparison that missed that would cry inflation every time somebody
  // bought a spare.
  check('a rise', comparePrice(2.29, 2.59).direction, 'up')
  check('by how much', comparePrice(2.29, 2.59).delta, 0.3)
  check('as a percentage', comparePrice(2.00, 2.50).pct, 25)
  check('a fall', comparePrice(2.59, 2.29).direction, 'down')
  check('and its sign', comparePrice(2.59, 2.29).delta, -0.3)
  check('no change', comparePrice(2.59, 2.59).direction, 'same')
  // Stored money is a float. 1.6966666 must not report itself as a rise.
  check('rounded before comparing', comparePrice(1.6966666, 1.7).direction, 'same')
  check('a first purchase has no percentage to give', comparePrice(0, 2.59).pct, 0)
})

describe('Last paid, derived from stock rather than cached', () => {
  const items = [
    { productId: 1, price: 2.29, qtyInitial: 1, purchasedAt: '2026-08-01' },
    { productId: 1, price: 2.59, qtyInitial: 1, purchasedAt: '2026-08-21' },
    // Two jars in one line: the unit price is half the line, not the line.
    { productId: 2, price: 5.18, qtyInitial: 2, purchasedAt: '2026-08-21' },
    // No price recorded — cannot contribute an answer.
    { productId: 3, price: undefined, qtyInitial: 1, purchasedAt: '2026-08-21' },
  ] as Parameters<typeof lastPaidByProduct>[0]

  const map = lastPaidByProduct(items)
  check('the most recent wins', map.get(1)?.unitPrice, 2.59)
  check('and carries its date', map.get(1)?.date, '2026-08-21')
  check('a multi-buy is priced per unit', map.get(2)?.unitPrice, 2.59)
  check('an unpriced purchase says nothing', map.get(3), undefined)
  check('an unknown product says nothing', map.get(99), undefined)
})

console.log(
  failures
    ? `\n${failures} of ${checks} checks failed\n`
    : `\nAll ${checks} checks passed\n`,
)
process.exit(failures ? 1 : 0)
