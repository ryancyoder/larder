import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The Supabase connection.
 *
 * URL and anon key are baked into the bundle at build time. That's fine and
 * intended — the anon key is a public identifier, not a secret. What actually
 * protects the data is row-level security: every table is closed by default and
 * opens only to members of the owning household. Publishing the key without
 * those policies would publish the kitchen.
 *
 * Both are read from Vite env vars so a fork can point at its own project
 * without editing source.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Whether the app has somewhere to talk to at all.
 *
 * Checked rather than assumed so a build with missing env vars says so plainly
 * instead of failing later with a network error that looks like a bug.
 */
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient = createClient(
  url ?? 'https://unconfigured.supabase.co',
  anonKey ?? 'unconfigured',
  {
    auth: {
      // One household signs in once and stays signed in; this is a kitchen
      // appliance, not a banking app.
      persistSession: true,
      autoRefreshToken: true,
    },
  },
)

/** The household the signed-in account belongs to, or null when signed out. */
export async function currentHouseholdId(): Promise<number | null> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return null
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.household_id ?? null
}
