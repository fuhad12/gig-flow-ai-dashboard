import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getNicheSnapshot } from "@/lib/trends"
import { getNiche, NICHES } from "@/lib/niches"
import {
  getProfile,
  getTrendScrapeQuota,
  recordTrendScrape,
} from "@/lib/quota"

export const runtime = "nodejs"
export const maxDuration = 90

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params

  if (!getNiche(slug)) {
    return NextResponse.json(
      {
        error: `Unknown niche: ${slug}`,
        available: NICHES.map((n) => n.slug),
      },
      { status: 404 },
    )
  }

  // Require auth — trends data sits behind login (also gates scrape spend).
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
      { error: "You must be signed in to view trends" },
      { status: 401 },
    )
  }

  const url = new URL(req.url)
  const refreshRequested = url.searchParams.get("refresh") === "true"

  // ---- Scope gate: only pinned niches can trigger a scrape ----
  //
  // Firecrawl/Apify spend is gated to niches the user pinned in Settings.
  // Non-pinned niches get a readOnly snapshot (shared cache if any).
  const profile = await getProfile(user.id)
  const isPinned = profile.selectedNiches.includes(slug)

  // ---- Trend scrape quota (Free 2 / Pro 7 / Agency 15 per month) ----
  //
  // Separate from AI credits. Cached reads are free; only a real scrape
  // burns one trend scrape. Explicit refresh while out of quota → 402.
  let trendQuota
  try {
    trendQuota = await getTrendScrapeQuota(user.id)
  } catch (err) {
    console.error("[trends] getTrendScrapeQuota failed:", err)
    return NextResponse.json(
      {
        error: "Could not load your trend scrape balance. Try again in a moment.",
      },
      { status: 503 },
    )
  }
  const canScrape = isPinned && trendQuota.allowed

  if (refreshRequested && !canScrape) {
    if (!isPinned) {
      return NextResponse.json(
        {
          error:
            "Add this niche to your selection in Settings → My niches & skills before refreshing — we only scrape niches you've pinned.",
          niches: NICHES,
        },
        { status: 403 },
      )
    }
    return NextResponse.json(
      {
        error: trendQuota.isPremium
          ? `You've used all ${trendQuota.limit} trend scrapes this month. Upgrade your plan or wait until next month.`
          : `Free plan includes ${trendQuota.limit} trend scrapes per month. Upgrade to Pro for more.`,
        trendQuota,
      },
      { status: 402 },
    )
  }

  try {
    const { snapshot, scraped } = await getNicheSnapshot(slug, {
      refresh: refreshRequested && canScrape,
      readOnly: !canScrape,
    })

    if (scraped) {
      await recordTrendScrape(user.id, slug)
      trendQuota = await getTrendScrapeQuota(user.id)
    }

    // Soft empty state when there's nothing cached and we couldn't scrape.
    if (snapshot.gigs.length === 0) {
      const emptyReason: "not_pinned" | "out_of_trend_quota" | "no_data_yet" =
        !isPinned
          ? "not_pinned"
          : !trendQuota.allowed
            ? "out_of_trend_quota"
            : "no_data_yet"

      return NextResponse.json(
        {
          niches: NICHES,
          snapshot: null,
          pinned: isPinned,
          canRefresh: canScrape && trendQuota.allowed,
          emptyReason,
          trendQuota,
        },
        { status: 200 },
      )
    }

    return NextResponse.json(
      {
        niches: NICHES,
        snapshot,
        pinned: isPinned,
        canRefresh: isPinned && trendQuota.allowed,
        trendQuota,
      },
      { status: 200 },
    )
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load niche trends"
    console.error("[trends] snapshot failed:", message)
    if (!isPinned) {
      return NextResponse.json(
        {
          niches: NICHES,
          snapshot: null,
          pinned: false,
          canRefresh: false,
          emptyReason: "not_pinned" as const,
          trendQuota,
        },
        { status: 200 },
      )
    }
    return NextResponse.json({ error: message, trendQuota }, { status: 502 })
  }
}
