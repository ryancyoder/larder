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
