import { NextResponse, type NextRequest } from "next/server"
import { createServerClient, type CookieOptions } from "@supabase/ssr"
import type { EmailOtpType } from "@supabase/supabase-js"

/**
 * Email-link confirm without PKCE (works across browsers/devices).
 *
 * Supabase templates should use:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/update-password
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = sanitizeNext(searchParams.get("next"))

  if (!token_hash || !type) {
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent("Invalid or incomplete confirm link")}`,
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent("Supabase is not configured on the server")}`,
    )
  }

  const redirectTo =
    type === "recovery" ? "/auth/update-password" : next
  const redirectResponse = NextResponse.redirect(
    `${origin}${sanitizeNext(redirectTo)}`,
  )

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) {
        cookiesToSet.forEach(({ name, value, options }) => {
          redirectResponse.cookies.set(name, value, options)
        })
      },
    },
  })

  const { error } = await supabase.auth.verifyOtp({ type, token_hash })
  if (error) {
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent(error.message)}`,
    )
  }

  return redirectResponse
}

function sanitizeNext(raw: string | null): string {
  if (!raw) return "/"
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}
