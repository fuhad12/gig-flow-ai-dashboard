/**
 * Refresh tracked-gig snapshots.
 *
 * Two modes:
 * - **User-initiated** (POST, no auth header): refreshes the signed-in
 *   user's gigs. Ignores the staleness window.
 * - **Cron-initiated** (GET or POST + `Authorization: Bearer <CRON_SECRET>`):
 *   refreshes ALL users' tracked gigs that are older than the staleness
 *   window (default 6h). Schedule in `vercel.json` is once daily on Hobby.
 *
 * Vercel Cron Jobs always hit your function with `GET` — so we expose both
 * GET (cron only) and POST (cron OR user). `vercel.json` ships in the repo
 * root with the schedule; Vercel auto-injects the `Authorization` header
 * using the value of `CRON_SECRET`.
 */

import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { refreshDueGigs } from "@/lib/tracking"
import { refreshDueKeywords } from "@/lib/serp-tracking"

export const runtime = "nodejs"
// Cron mode can take a while — up to 200 gigs × ~5s scrape, plus the
// SERP keyword checks layered on top.
export const maxDuration = 300

function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get("authorization") ?? ""
  return auth === `Bearer ${secret}`
}

async function runCron() {
  // Refresh gig snapshots first (cheaper / faster per-gig) so a SERP
  // timeout doesn't starve the gig-history feature.
  const gigResults = await refreshDueGigs({
    minIntervalMs: 6 * 3600_000,
    limit: 200,
  })
  const keywordResults = await refreshDueKeywords({
    minIntervalMs: 12 * 3600_000,
    limit: 100,
  })
  return NextResponse.json(
    {
      gigs: {
        results: gigResults,
        refreshed: gigResults.filter((r) => r.ok).length,
        failed: gigResults.filter((r) => !r.ok).length,
      },
      keywords: {
        results: keywordResults,
        refreshed: keywordResults.filter((r) => r.ok).length,
        failed: keywordResults.filter((r) => !r.ok).length,
      },
      mode: "cron",
    },
    { status: 200 },
  )
}

export async function GET(req: Request) {
  // GET is for cron only. Reject anything else loudly so a casual browser
  // visit doesn't accidentally kick off 200 scrapes.
  if (!isCronRequest(req)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    )
  }
  return runCron()
}

export async function POST(req: Request) {
  if (isCronRequest(req)) {
    return runCron()
  }

  // User-initiated path.
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

  // For a manual refresh we ignore the staleness window so users can force
  // an update even on a fresh-ish gig.
  const results = await refreshDueGigs({
    userId: user.id,
    minIntervalMs: 0,
    limit: 50,
  })

  return NextResponse.json(
    {
      results,
      refreshed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      mode: "user",
    },
    { status: 200 },
  )
}
