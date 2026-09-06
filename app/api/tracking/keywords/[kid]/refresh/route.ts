/**
 * Manually re-check a single SERP keyword's rank.
 *
 *   POST /api/tracking/keywords/:kid/refresh
 *
 * Auth + ownership checked inside `refreshKeyword` (via the parent gig).
 */

import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getKeyword, refreshKeyword } from "@/lib/serp-tracking"

export const runtime = "nodejs"
export const maxDuration = 90

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ kid: string }> },
) {
  const { kid } = await ctx.params
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

  // Ownership check before kicking off an expensive scrape.
  const found = await getKeyword(user.id, kid)
  if (!found) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const result = await refreshKeyword(kid)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ snapshot: result.snapshot }, { status: 200 })
}
