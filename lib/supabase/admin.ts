import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Service-role Supabase client. SERVER-ONLY. NEVER import this from a Client
 * Component or any file with the "use client" directive — the service key
 * bypasses RLS and would be devastating if it leaked to the browser.
 *
 * Returns `null` if either env var is missing, so the rest of the app keeps
 * working (caching and quota enforcement just become no-ops).
 */
let cached: SupabaseClient | null = null
let warned = false

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    if (!warned && process.env.NODE_ENV !== "production") {
      console.warn(
        "[supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY " +
          "is not set — server-side persistence is disabled.",
      )
      warned = true
    }
    return null
  }

  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  return cached
}
