import { createBrowserClient } from "@supabase/ssr"

/**
 * Singleton browser-side Supabase client. Reads the public anon key only;
 * never touches the service role.
 */
let cached: ReturnType<typeof createBrowserClient> | null = null

export function createSupabaseBrowser() {
  if (cached) return cached
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  return cached
}
