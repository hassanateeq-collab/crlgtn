import { createClient } from '@supabase/supabase-js'

/**
 * The browser client. Holds the publishable key only, and can therefore do
 * exactly two things: authenticate, and SELECT under RLS.
 *
 * It cannot write. Migration 004 revoked INSERT/UPDATE/DELETE from the
 * `authenticated` and `anon` roles, so every mutation must go through an Edge
 * Function (see lib/api.ts). That is spec §4's hard rule, enforced by the
 * database rather than by our discipline.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !publishableKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy web/.env.example to web/.env.',
  )
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

export const SUPABASE_URL = url
