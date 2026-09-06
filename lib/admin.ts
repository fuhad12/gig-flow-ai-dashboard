/**
 * Admin access control — env allowlist only (no DB role).
 * ADMIN_EMAILS=you@jobflow.win,other@example.com
 */

import type { User } from "@supabase/supabase-js"

import { createSupabaseServer } from "@/lib/supabase/server"

export function parseAdminEmails(
  raw: string | undefined = process.env.ADMIN_EMAILS,
): Set<string> {
  if (!raw?.trim()) return new Set()
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return parseAdminEmails().has(email.trim().toLowerCase())
}

export type RequireAdminResult =
  | { ok: true; user: User; email: string }
  | { ok: false; status: 401 | 403; error: string }

/**
 * Server-only: require a signed-in user whose email is in ADMIN_EMAILS.
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return { ok: false, status: 401, error: "Auth is not configured" }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, status: 401, error: "Sign in required" }
  }

  const email = user.email?.trim() ?? ""
  if (!isAdminEmail(email)) {
    return { ok: false, status: 403, error: "Admin access required" }
  }

  return { ok: true, user, email }
}
