import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getNicheSnapshot } from "@/lib/trends"
import { getNiche, NICHES } from "@/lib/niches"
import { getProfile, getQuotaStatus } from "@/lib/quota"

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

  // Require auth — trends data sits behind login (also gates Firecrawl spend).
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

  // ---- Scope gate: only pinned niches can trigger a Firecrawl call ----
  //
  // Firecrawl spend is the single biggest variable cost we have. We
  // restrict EVERY path that hits Firecrawl — explicit refresh,
  // cache-miss scrape, AND stale-cache auto-refresh — to niches the
  // user has pinned in Settings. This keeps the crawl tightly scoped
  // to what the user actually cares about instead of fetching the
  // entire catalog of services.
  //
  // For non-pinned niches the user gets a `readOnly` snapshot: any
  // cached gigs render (even if stale), and they see an empty state +
  // "pin this niche" hint when the cache is empty. Refresh requests
  // come back as 403 with the same hint so the UI can show a CTA.
  const profile = await getProfile(user.id)
  const isPinned = profile.selectedNiches.includes(slug)

  // ---- Credit gate ----
  //
  // Even for pinned niches, refresh and cache-miss scrapes consume
  // billable resources (Firecrawl + downstream LLM analysis). When the
  // user has run their monthly AI credit pool dry we refuse those
  // scrapes and serve whatever's cached. Explicit refresh requests
  // surface as a 402 so the client can pop the paywall.
  const quota = await getQuotaStatus(user.id)
  const canScrape = isPinned && quota.allowed

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
        error: quota.isPremium
          ? "You've used all your monthly AI credits. Buy a credit top-up to refresh trends."
          : "Free plan limit reached. Upgrade to Pro to refresh trends.",
        quota,
      },
      { status: 402 },
    )
  }

  try {
    const snapshot = await getNicheSnapshot(slug, {
      // Explicit refresh only allowed on pinned + in-budget niches.
      refresh: refreshRequested && canScrape,
      // Block ALL scrapes (cache miss, stale auto-refresh) for niches
      // the user hasn't pinned or when they're out of credits.
      readOnly: !canScrape,
    })

    // ---- Soft empty state for "no data yet" cases ----
    //
    // Earlier versions of this route returned 403 / 402 here, which
    // made the client render a red "Could not load trends" error
    // banner — confusing because nothing was actually broken. Browsing
    // an unpinned niche should feel like an opt-in step, not a server
    // failure. We now return 200 with `snapshot: null` and an
    // `emptyReason` flag the client uses to pick the right friendly
    // empty state (pin CTA, paywall CTA, etc.).
    //
    // 402 stays only for the case where the user EXPLICITLY hit
    // "Refresh" on a pinned niche while out of credits — that one
    // needs to pop the paywall modal, not render an empty card.
    if (snapshot.gigs.length === 0) {
      const emptyReason: "not_pinned" | "out_of_credits" | "no_data_yet" =
        !isPinned
          ? "not_pinned"
          : !quota.allowed
            ? "out_of_credits"
            : "no_data_yet"

      return NextResponse.json(
        {
          niches: NICHES,
          snapshot: null,
          pinned: isPinned,
          canRefresh: canScrape,
          emptyReason,
          quota,
        },
        { status: 200 },
      )
    }

    return NextResponse.json(
      { niches: NICHES, snapshot, pinned: isPinned, canRefresh: canScrape },
      { status: 200 },
    )
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load niche trends"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
