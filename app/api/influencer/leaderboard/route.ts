import { NextResponse } from "next/server"

import { isAdminEmail } from "@/lib/admin"
import {
  buildInfluencerLeaderboard,
  type LeaderboardPeriod,
} from "@/lib/influencer-leaderboard"
import { normalizeInfluencerEmail } from "@/lib/referral"
import { createSupabaseServer } from "@/lib/supabase/server"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Partner + admin leaderboard. Auth required; caller must be an influencer
 * or an admin. Returns rankings (no partner emails) plus the caller's id
 * so the UI can highlight "you".
 */
export async function GET(req: Request) {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Auth is not configured" },
      { status: 500 },
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: "Database is not configured" },
      { status: 500 },
    )
  }

  const email = normalizeInfluencerEmail(user.email)
  const isAdmin = isAdminEmail(user.email)

  const { data: influencer } = await admin
    .from("influencers")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle()

  const isPartner =
    !!influencer &&
    normalizeInfluencerEmail(influencer.email as string) === email

  if (!isAdmin && !isPartner) {
    return NextResponse.json(
      { error: "Partner or admin access required" },
      { status: 403 },
    )
  }

  const url = new URL(req.url)
  const periodRaw = url.searchParams.get("period") ?? "all"
  const period: LeaderboardPeriod =
    periodRaw === "month" ? "month" : "all"

  const { entries } = await buildInfluencerLeaderboard(period)

  return NextResponse.json({
    period,
    viewerInfluencerId: isPartner ? (influencer!.id as string) : null,
    entries,
  })
}
