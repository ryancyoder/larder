import type { ItemView, Recipe, Unit } from '../db/schema'
import { ALL_UNITS } from './units'
import { freshnessOf } from './inventory'
import { todayISO } from './dates'

/**
 * Optional Claude-powered recipe generation.
 *
 * The whole app works without this — the ranking engine in suggest.ts is the
 * default. Drop an API key into Settings and this turns on. The key is stored
 * in this browser's IndexedDB and is sent only to api.anthropic.com.
 */

const MODEL = 'claude-opus-5'
const ENDPOINT = 'https://api.anthropic.com/v1/messages'

/** Matches the Recipe shape minus the fields the app owns (id, timesCooked…). */
const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          emoji: { type: 'string' },
          description: { type: 'string' },
          servings: { type: 'integer' },
          prepMin: { type: 'integer' },
          cookMin: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                qty: { type: 'number' },
                unit: { type: 'string', enum: ALL_UNITS },
                optional: { type: 'boolean' },
              },
              required: ['name'],
              additionalProperties: false,
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
          usesUpFirst: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of the expiring items this recipe rescues',
          },
        },
        required: ['title', 'emoji', 'description', 'servings', 'prepMin', 'cookMin', 'tags', 'ingredients', 'steps', 'usesUpFirst'],
        additionalProperties: false,
      },
    },
  },
  required: ['recipes'],
  additionalProperties: false,
} as const

export interface GeneratedRecipe {
  title: string
  emoji: string
  description: string
  servings: number
  prepMin: number
  cookMin: number
  tags: string[]
  ingredients: Array<{ name: string; qty?: number; unit?: Unit; optional?: boolean }>
  steps: string[]
  usesUpFirst: string[]
}

function describeStock(stock: ItemView[]): string {
  return stock
    .filter((i) => i.available > 0)
    .map((i) => {
      const f = freshnessOf(i)
      const expiry = f.days === null ? '' : f.days < 0 ? ' (EXPIRED)' : ` (${f.days}d left)`
      const held = i.reserved > 0 ? ` [${i.reserved} reserved for another meal — do not use]` : ''
      return `- ${i.name}: ${i.available} ${i.unit} in the ${i.location}${expiry}${held}`
    })
    .join('\n')
}

export function buildPrompt(stock: ItemView[], count: number, note: string): string {
  const expiring = stock
    .filter((i) => {
      const f = freshnessOf(i)
      return f.days !== null && f.days <= 4 && f.days >= 0 && i.available > 0
    })
    .map((i) => i.name)

  return [
    `Today is ${todayISO()}. Here is everything currently in my kitchen:`,
    '',
    describeStock(stock),
    '',
    expiring.length
      ? `These need using up first: ${expiring.join(', ')}.`
      : 'Nothing is close to expiring.',
    '',
    note ? `Extra context from me: ${note}` : '',
    '',
    `Suggest ${count} recipes I can cook mostly from this list. Rules:`,
    '- Prioritise recipes that use up the items flagged as expiring.',
    '- Never rely on quantities marked as reserved for another meal.',
    '- Assume I have salt, pepper, cooking oil, water, flour and sugar.',
    '- It is fine if a recipe needs one or two common things I do not have; list them as ingredients anyway.',
    '- Give real, specific steps a home cook can follow, not a summary.',
    '- Pick one food emoji per recipe.',
  ]
    .filter(Boolean)
    .join('\n')
}

export class AIError extends Error {}

export async function generateRecipes(
  apiKey: string,
  stock: ItemView[],
  count = 3,
  note = '',
): Promise<GeneratedRecipe[]> {
  if (!apiKey) throw new AIError('No API key set. Add one in Settings.')

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for calling the API straight from a browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        output_config: { format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
        messages: [{ role: 'user', content: buildPrompt(stock, count, note) }],
      }),
    })
  } catch {
    throw new AIError('Could not reach the API. Check your connection.')
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 401) throw new AIError('That API key was rejected.')
    if (res.status === 429) throw new AIError('Rate limited — try again in a moment.')
    throw new AIError(`API error ${res.status}. ${detail.slice(0, 200)}`)
  }

  const data = await res.json()

  // Safety classifiers can decline a request; content is empty when they do.
  if (data.stop_reason === 'refusal') {
    throw new AIError('The model declined that request.')
  }

  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')

  try {
    const parsed = JSON.parse(text) as { recipes: GeneratedRecipe[] }
    return parsed.recipes ?? []
  } catch {
    throw new AIError('The response was not in the expected format.')
  }
}

/** Turns a generated recipe into a row the rest of the app can use. */
export function toRecipe(g: GeneratedRecipe): Omit<Recipe, 'id'> {
  return {
    title: g.title,
    emoji: g.emoji || '🍽️',
    description: g.description,
    servings: g.servings || 2,
    prepMin: g.prepMin || 0,
    cookMin: g.cookMin || 0,
    tags: g.tags ?? [],
    ingredients: g.ingredients ?? [],
    steps: g.steps ?? [],
    favorite: false,
    source: 'ai',
    createdAt: todayISO(),
    timesCooked: 0,
  }
}


// ---------------------------------------------------------------------------
// Naming a photograph
//
// The fallback for everything a barcode can't answer: loose produce, a bag of
// apples, a packet photographed from the wrong side. Opt-in per batch, because
// unlike every other part of this app it sends your pictures off the device and
// costs money per photo.
// ---------------------------------------------------------------------------

const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Plain grocery name, e.g. "Bananas", "Cheddar". Empty if unsure.' },
    brand: { type: 'string' },
    barcode: { type: 'string', description: 'Digits only, if legibly visible. Empty otherwise.' },
    category: { type: 'string' },
    confident: { type: 'boolean', description: 'False if this is a guess worth a human check.' },
  },
  required: ['name', 'confident'],
  additionalProperties: false,
} as const

export interface PhotoGuess {
  name: string
  brand?: string
  barcode?: string
  category?: string
  confident: boolean
}

/** Blob to the base64 the API wants, without the data-URL prefix. */
async function toBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  // Chunked: spreading a large array into String.fromCharCode blows the stack.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

export async function identifyPhoto(
  apiKey: string,
  image: Blob,
  categories: string[],
): Promise<PhotoGuess | null> {
  if (!apiKey) throw new AIError('No API key set. Add one in Settings.')

  const media = image.type && image.type.startsWith('image/') ? image.type : 'image/webp'

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        output_config: { format: { type: 'json_schema', schema: PHOTO_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: await toBase64(image) } },
            {
              type: 'text',
              text: [
                'This is one grocery item photographed at home while unpacking shopping.',
                'Give it the short everyday name someone would write on a shopping list —',
                '"Bananas", not "a bunch of ripe yellow bananas".',
                'Read the brand and any barcode digits only if they are legible; do not invent them.',
                `Pick the best category from: ${categories.join(', ')}.`,
                'Set confident to false if the picture is unclear or it could plausibly be',
                'more than one thing — a wrong name that looks certain is worse than an',
                'honest blank, because nobody re-checks it.',
              ].join(' '),
            },
          ],
        }],
      }),
    })
  } catch {
    throw new AIError('Could not reach the API. Check your connection.')
  }

  if (!res.ok) {
    if (res.status === 401) throw new AIError('That API key was rejected.')
    if (res.status === 429) throw new AIError('Rate limited — try again in a moment.')
    throw new AIError(`API error ${res.status}.`)
  }

  const data = await res.json()
  const block = data?.content?.find((c: { type: string }) => c.type === 'text')
  if (!block?.text) return null
  try {
    const guess = JSON.parse(block.text) as PhotoGuess
    return guess.name?.trim() ? guess : null
  } catch {
    return null
  }
}


// ---------------------------------------------------------------------------
// Reading a receipt
//
// The photo counterpart to the text parser in lib/receipt.ts. The model's job
// here is transcription, not interpretation: it reads the rows off the paper
// and the parser does the rest, so a photographed receipt and a pasted one meet
// the same code and behave the same way.
// ---------------------------------------------------------------------------

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    store: { type: 'string', description: 'Shop name as printed. Empty if not visible.' },
    date: { type: 'string', description: 'Purchase date as yyyy-mm-dd. Empty if not legible.' },
    printedTotal: { type: 'number', description: 'The TOTAL line. 0 if not visible.' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          barcode: { type: 'string', description: 'Product code digits as printed. Empty if the line has none.' },
          description: { type: 'string', description: 'Item text exactly as printed, abbreviations and all.' },
          qty: { type: 'number', description: 'Units bought. 1 unless the line says otherwise.' },
          price: { type: 'number', description: 'What the line cost in total. Negative for a discount.' },
        },
        required: ['description', 'qty', 'price'],
        additionalProperties: false,
      },
    },
  },
  required: ['store', 'date', 'printedTotal', 'lines'],
  additionalProperties: false,
} as const

export interface ReceiptScan {
  store: string
  date: string
  printedTotal: number
  lines: Array<{ barcode?: string; description: string; qty: number; price: number }>
}

/**
 * A photographed receipt, transcribed.
 *
 * Deliberately asks for the description *unexpanded*. The model would happily
 * turn "GV SHRD MOZZ 8Z" into "Great Value Shredded Mozzarella 8 oz", but then
 * the two import routes would disagree about the same shop, and a mistake in
 * the expansion would be invisible — there would be nothing left to compare it
 * against. Keeping the till text means `expandDescription` stays the single
 * place that guesses, and the raw text is still on screen to check it.
 */
export async function readReceiptPhoto(apiKey: string, image: Blob): Promise<ReceiptScan | null> {
  if (!apiKey) throw new AIError('No API key set. Add one in Settings.')

  const media = image.type && image.type.startsWith('image/') ? image.type : 'image/webp'

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: await toBase64(image) } },
            {
              type: 'text',
              text: [
                'This is a photograph of a grocery till receipt.',
                'Transcribe every purchased line: the product code if one is printed, the',
                'description exactly as printed, the quantity, and what the line cost in total.',
                'Keep the shop\'s abbreviations verbatim — do not expand "GV SHRD MOZZ" into',
                'real words, and do not tidy the spelling. Something else does that, and it',
                'needs the original to check itself against.',
                'Skip subtotals, tax, tender, change, card details and store furniture.',
                'Include discounts and coupons as lines with a negative price.',
                'If a line\'s price is illegible, leave it out rather than guessing — a wrong',
                'price is worse than a missing one, because nobody re-checks a number that',
                'looks plausible.',
              ].join(' '),
            },
          ],
        }],
      }),
    })
  } catch {
    throw new AIError('Could not reach the API. Check your connection.')
  }

  if (!res.ok) {
    if (res.status === 401) throw new AIError('That API key was rejected.')
    if (res.status === 429) throw new AIError('Rate limited — try again in a moment.')
    throw new AIError(`API error ${res.status}.`)
  }

  const data = await res.json()
  if (data.stop_reason === 'refusal') throw new AIError('The model declined to read that image.')

  const block = data?.content?.find((c: { type: string }) => c.type === 'text')
  if (!block?.text) return null
  try {
    const scan = JSON.parse(block.text) as ReceiptScan
    return scan.lines?.length ? scan : null
  } catch {
    return null
  }
}
