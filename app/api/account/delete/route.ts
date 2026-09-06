/**
 * DELETE / wipe the signed-in user's account.
 *
 * Flow:
 *   1. Confirm the caller is the user they say they are (Supabase session).
 *   2. Use the service-role client to call `auth.admin.deleteUser`.
 *   3. ON DELETE CASCADE on `auth.users(id)` wipes:
 *        - public.profiles (FK)
 *        - public.gig_analyses (FK)
 *        - public.tracked_gigs (FK) — cascades to tracked_gig_snapshots
 *      so no extra cleanup is needed.
 *   4. Sign the user out of this session.
 *
 * Stripe note: we do NOT cancel the user's subscription here. The user has
 * to do that from the customer portal (or we trust the cascade-out behavior
 * if they never log back in). If the account is deleted with an active sub,
 * the next renewal still succeeds on Stripe's side but no longer maps to a
 * profile in our DB.
 */

import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"

export async function POST() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured on the server" },
      { status: 500 },
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in" },
      { status: 401 },
    )
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json(
      {
        error:
          "Account deletion requires the service-role key. Contact support if this persists.",
      },
      { status: 500 },
    )
  }

  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id)
  if (deleteErr) {
    console.error("[account-delete] failed:", deleteErr.message)
    return NextResponse.json(
      { error: `Could not delete account: ${deleteErr.message}` },
      { status: 500 },
    )
  }

  // End the session in this request so the next page load knows the user
  // is gone (the auth row is already deleted, so the cookie token would
  // 401 anyway — this is just a clean sign-out).
  await supabase.auth.signOut().catch(() => {})

  return NextResponse.json({ ok: true }, { status: 200 })
}
