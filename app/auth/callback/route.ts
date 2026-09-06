import { NextResponse, type NextRequest } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"

/**
 * Single landing page for every email link Supabase sends — signup
 * confirmation links and password reset links both bounce through here.
 *
 * Flow:
 *   user clicks email link →
 *   Supabase verifies the token and redirects to
 *     /auth/callback?code=<...>&next=<optional path>  →
 *   we exchange the code for a session cookie and forward to `next` (or `/`).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = sanitizeNext(searchParams.get("next"))

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent("Missing code in callback URL")}`,
    )
  }

  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent("Supabase is not configured on the server")}`,
    )
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent(error.message)}`,
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}

/**
 * Only allow internal redirects to prevent open-redirect abuse.
 */
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/"
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}
