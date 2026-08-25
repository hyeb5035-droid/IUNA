import 'server-only'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase admin environment variables')
}

/**
 * Service-role client for server-only administrative operations.
 *
 * Rules:
 * - Never import this module into Client Components or browser-accessible code.
 * - Use only for the minimum privileged operations that cannot be done with the anon/authenticated client.
 * - Does NOT bypass RLS for public schema tables by default; auth.admin methods operate on auth schema only.
 */
export function createAdminSupabaseClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
