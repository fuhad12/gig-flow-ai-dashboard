/**
 * Side-by-side gig comparison endpoint.
 *
 *   POST /api/compare
 *   body: { urls: string[] }            (2 or 3 entries; first = the user's)
 *
 * Premium-only. Each URL that requires a fresh analyze (i.e. not in
 * cache) burns one AI credit from the monthly quota. If the call would
 * blow past the quota we 402 before doing any work.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import { compareGigs } from "@/lib/compare"
import { getQuotaStatus } from "@/lib/quota"

export const runtime = "nodejs"
// 3 parallel scrape+analyze calls can take a while.
export const maxDuration = 180

const RequestSchema = z.object({
  urls: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .url("Each entry must be a valid URL"),
    )
    .min(2, "Compare requires at least 2 gigs")
    .max(3, "Compare supports up to 3 gigs at once"),
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    )
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid request",
      },
      { status: 400 },
    )
  }

  // De-dup URLs while preserving order (first wins).
  const seen = new Set<string>()
  const urls = parsed.data.urls.filter((u) => {
    const k = u.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (urls.length < 2) {
    return NextResponse.json(
      { error: "Provide at least 2 distinct gig URLs" },
      { status: 400 },
    )
  }

  // Auth.
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

  // Premium gate.
  const quota = await getQuotaStatus(user.id)
  if (!quota.isPremium) {
    return NextResponse.json(
      {
        error:
          "Side-by-side comparison is a Premium feature. Upgrade to compare your gig against competitors.",
        upgrade: true,
        quota,
      },
      { status: 402 },
    )
  }

  // Cost projection: every URL in the comparison burns one credit (each
  // one inserts a row into `gig_analyses` via `loadOrAnalyze`, even on a
  // cache hit). `quota.remaining` already covers BOTH monthly and topup
  // pools, so a user with topup balance can run comparisons past their
  // monthly cap.
  const projected = urls.length
  if (projected > quota.remaining) {
    return NextResponse.json(
      {
        error: `This comparison needs ${projected} AI credits but you only have ${quota.remaining} remaining this month. Buy a credit top-up to continue.`,
        upgrade: false,
        quota,
      },
      { status: 402 },
    )
  }

  try {
    const report = await compareGigs(user.id, urls)
    return NextResponse.json({ ok: true, ...report }, { status: 200 })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Comparison failed"
    // Lean toward 502 since this is almost always upstream (scrape/LLM).
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    )
  }
}
