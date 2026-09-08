"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Flame,
  Search,
  BarChart3,
  Globe,
  RefreshCw,
  Loader2,
  ExternalLink,
  AlertCircle,
  Star,
  Sparkles,
} from "lucide-react"

import { DEFAULT_NICHE_SLUG, NICHES, getNiche, type NicheDef } from "@/lib/niches"
import type {
  KeywordCount,
  NicheGig,
  NicheSnapshot,
  PriceStats,
} from "@/lib/trends"
import { TrendsInsightsCard } from "@/components/trends-insights-card"
import { TrendsPriceChart } from "@/components/trends-price-chart"
import { KeywordDiscoveryCard } from "@/components/keyword-discovery-card"

/**
 * Reason the server returned a 200 with `snapshot: null`. Drives the
 * empty-state UI: "not_pinned" shows a pin CTA, "out_of_trend_quota"
 * shows an upgrade CTA, "no_data_yet" shows a retry scrape CTA.
 * Legacy "out_of_credits" is accepted for older responses.
 */
type EmptyReason =
  | "not_pinned"
  | "out_of_trend_quota"
  | "out_of_credits"
  | "no_data_yet"

interface TrendQuotaInfo {
  used: number
  limit: number
  remaining: number
  allowed: boolean
}

interface TrendsResponse {
  niches: NicheDef[]
  snapshot: NicheSnapshot | null
  /** Whether the active slug is in the user's pinned niches. */
  pinned?: boolean
  /**
   * Whether the user has both pinned this niche AND has trend scrapes
   * left this month. Drives the "upgrade to refresh" banner.
   */
  canRefresh?: boolean
  /** Present when `snapshot === null` so the client knows why. */
  emptyReason?: EmptyReason
  trendQuota?: TrendQuotaInfo
}

interface TrendsViewProps {
  /**
   * Callback fired when the user clicks "Generate gig in this niche". The
   * dashboard uses this to switch views and pre-fill the generator.
   */
  onGenerateInNiche?: (slug: string) => void
  /**
   * Optional richer callback used by the keyword-discovery card. If
   * provided, takes precedence over `onGenerateInNiche` and lets us
   * pass a seed skill phrase alongside the niche.
   */
  onGenerateWithKeyword?: (slug: string, skill: string) => void
  /**
   * Called when the server returns 402 from a trends action (refresh,
   * regenerate insights, fresh scrape). Lets the dashboard pop the
   * paywall modal the same way the analyzer / generator do.
   */
  onQuotaExceeded?: () => void
  /**
   * Called when the user clicks the upgrade CTA inside the "cached data"
   * banner. Distinct from `onQuotaExceeded` so the banner can route to
   * the marketing tiers tab even when the user still has credits left
   * (e.g. a free user previewing the page).
   */
  onUpgrade?: () => void
  /**
   * Called when the user clicks the "Open Settings to pin" CTA inside
   * the unpinned-niche empty state. Routes them to the Settings view so
   * they can actually do what we're asking — earlier this was wired to
   * `onUpgrade` and incorrectly opened the paywall modal instead.
   */
  onOpenSettings?: () => void
  /**
   * Whether the user is on a paid plan. Drives banner copy — Pro/Agency
   * users out of monthly trend scrapes see wait/upgrade, free users see
   * "upgrade to Pro".
   */
  isPremium?: boolean
}

export function TrendsView({
  onGenerateInNiche,
  onGenerateWithKeyword,
  onQuotaExceeded,
  onUpgrade,
  onOpenSettings,
  isPremium = false,
}: TrendsViewProps = {}) {
  // Niches the user pinned in Settings → drives the dropdown. While we wait
  // for the first fetch we hide the dropdown options entirely (rather than
  // briefly showing all 16 and then clipping) to avoid a confusing flash.
  const [pinnedNiches, setPinnedNiches] = useState<string[] | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string>(DEFAULT_NICHE_SLUG)
  const [snapshot, setSnapshot] = useState<NicheSnapshot | null>(null)
  // Server-reported flags for the currently-loaded snapshot. `pinned` says
  // whether the active slug is in the user's pinned list; `canRefresh`
  // says whether the user has both pinned it AND has budget left. We
  // surface a "subscribe for fresh data" banner when canRefresh === false.
  const [pinned, setPinned] = useState<boolean>(false)
  const [canRefresh, setCanRefresh] = useState<boolean>(false)
  const [trendQuota, setTrendQuota] = useState<TrendQuotaInfo | null>(null)
  /**
   * Soft empty-state reason when the API returned 200 with snapshot:null.
   * Distinct from hard `error` — these are expected UX states (pin niche,
   * out of trend scrapes, cold cache) rather than failures.
   */
  const [emptyReason, setEmptyReason] = useState<EmptyReason | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Niches list loaded — dropdown can render; trends stay idle until button. */
  const [nichesReady, setNichesReady] = useState(false)

  // Pull the user's selection once on mount. If they have any pinned, seed
  // the dropdown with their first (primary) niche; otherwise we keep the
  // catalog-default and let the empty-state CTA prompt them to configure.
  useEffect(() => {
    let cancelled = false
    fetch("/api/profile/niches")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const selected = (data?.selectedNiches as string[] | undefined) ?? []
        setPinnedNiches(selected)
        if (selected.length > 0) setSelectedSlug(selected[0])
        setNichesReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setPinnedNiches([])
          setNichesReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Catalog used to populate the dropdown. When the user has pinned any
  // niches, restrict to those; otherwise fall back to the whole catalog so
  // the page still works pre-onboarding.
  const visibleNiches: NicheDef[] =
    pinnedNiches && pinnedNiches.length > 0
      ? (pinnedNiches
          .map((slug) => getNiche(slug))
          .filter((n): n is NicheDef => !!n))
      : NICHES

  const hasPinned = !!pinnedNiches && pinnedNiches.length > 0

  const load = useCallback(
    async (slug: string, refresh = false, signal?: AbortSignal) => {
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      // Clear the previous empty-state flag so we don't briefly show
      // the wrong card during a niche switch.
      setEmptyReason(null)

      const attempt = async () => {
        const url = `/api/trends/${encodeURIComponent(slug)}${refresh ? "?refresh=true" : ""}`
        const res = await fetch(url, { signal, cache: "no-store" })
        if (res.status === 402) {
          onQuotaExceeded?.()
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null
          throw new Error(data?.error ?? "Monthly trend scrape limit reached")
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null
          throw new Error(
            data?.error ?? `Request failed with status ${res.status}`,
          )
        }
        return (await res.json()) as TrendsResponse
      }

      try {
        let data: TrendsResponse
        try {
          data = await attempt()
        } catch (err) {
          // One retry on transient network / deploy blips.
          const msg = err instanceof Error ? err.message : String(err)
          if (
            signal?.aborted ||
            (!/Failed to fetch|NetworkError|Load failed|fetch/i.test(msg) &&
              !(err instanceof TypeError))
          ) {
            throw err
          }
          await new Promise((r) => setTimeout(r, 600))
          if (signal?.aborted) throw err
          data = await attempt()
        }
        if (signal?.aborted) return
        setSnapshot(data.snapshot)
        setPinned(Boolean(data.pinned))
        setCanRefresh(Boolean(data.canRefresh))
        setEmptyReason(data.emptyReason ?? null)
        setTrendQuota(data.trendQuota ?? null)
      } catch (err) {
        if (signal?.aborted) return
        const raw = err instanceof Error ? err.message : "Something went wrong"
        const friendly =
          /Failed to fetch|NetworkError|Load failed/i.test(raw) ||
          err instanceof TypeError
            ? "Couldn’t reach the trends server. Check your connection, pin a niche in Settings, then tap Refresh."
            : raw
        setError(friendly)
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [onQuotaExceeded],
  )

  const handleNicheChange = (slug: string) => {
    setSelectedSlug(slug)
    // Switching niches clears results — user must click Load again.
    setSnapshot(null)
    setPinned(false)
    setCanRefresh(false)
    setTrendQuota(null)
    setEmptyReason(null)
    setError(null)
    setLoading(false)
    setRefreshing(false)
  }

  const idle = nichesReady && !loading && !refreshing && !snapshot && !emptyReason && !error

  return (
    <ScrollArea className="h-full">
      <div className="p-4 sm:p-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground sm:text-xl">
              Trend & Niche Intelligence
            </h2>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Live market signals scraped from top-ranking Fiverr gigs
              {trendQuota
                ? ` · ${trendQuota.remaining}/${trendQuota.limit} scrapes left this month`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedSlug}
              onValueChange={handleNicheChange}
              disabled={!nichesReady || loading || refreshing}
            >
              <SelectTrigger className="w-full sm:w-52">
                <Globe className="mr-2 size-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visibleNiches.map((niche) => (
                  <SelectItem key={niche.slug} value={niche.slug}>
                    {niche.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {snapshot || emptyReason || error ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void load(selectedSlug, Boolean(snapshot))}
                disabled={
                  loading ||
                  refreshing ||
                  (!canRefresh && Boolean(snapshot) && !error)
                }
                className="gap-1.5"
                title={
                  !canRefresh && snapshot && !error
                    ? pinned
                      ? "Out of monthly trend scrapes — upgrade or wait until next month"
                      : "Pin this niche in Settings to enable refresh"
                    : undefined
                }
              >
                {refreshing || loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {error ? "Try again" : "Refresh"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void load(selectedSlug, false)}
                disabled={!nichesReady || loading}
                className="gap-1.5 bg-emerald text-white hover:bg-emerald/90"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
                Load trends
              </Button>
            )}
          </div>
        </div>

        {/* Empty-state nudge: user has never pinned any niches. We show
            the whole catalog so the page still works, but make the path
            to focusing it obvious. */}
        {pinnedNiches && !hasPinned && (
          <div className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-emerald/30 bg-emerald/5 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-foreground">
                Pin your niches to focus this page
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                We only scrape live Fiverr data for niches you&apos;ve
                pinned. Open Settings → My niches &amp; skills to pick the
                ones you sell in.
              </div>
            </div>
          </div>
        )}

        {/* Cached-only banner when the user can't scrape (unpinned or
            out of monthly trend scrapes). */}
        {snapshot && hasPinned && !canRefresh && (
          <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-violet-500/20 text-violet-300">
                  <Sparkles className="size-3" />
                </span>
                {pinned
                  ? "You're viewing cached trends"
                  : "This niche isn't in your selection"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {!pinned
                  ? "Pin this niche in Settings → My niches & skills to fetch live Fiverr data for it."
                  : isPremium
                    ? `You've used all ${trendQuota?.limit ?? ""} trend scrapes this month. Upgrade your plan or wait until next month for fresh scrapes.`
                    : "Free plan includes 2 trend scrapes per month. Upgrade to Pro for 7, or Agency for 15."}
              </div>
            </div>
            {pinned && (
              <Button
                size="sm"
                onClick={onUpgrade}
                className="shrink-0 gap-1.5 bg-violet-500 text-white hover:bg-violet-500/90"
              >
                {isPremium ? "Upgrade plan" : "Upgrade to Pro"}
              </Button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="font-medium">Could not load trends</div>
                <div className="text-xs text-danger/80">{error}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-danger/40 text-danger hover:bg-danger/10"
                onClick={() => void load(selectedSlug, false)}
                disabled={loading || refreshing}
              >
                Try again
              </Button>
              {onOpenSettings && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onOpenSettings}
                >
                  Open Settings
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Idle — wait for explicit Load trends click (no auto-scrape). */}
        {idle && (
          <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/40 px-6 text-center">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Ready when you are
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                Pick a niche
                {hasPinned ? "" : " (pin niches in Settings for live scrapes)"}
                , then load market signals. A live scrape uses 1 of your
                monthly trend scrapes; cached data is free.
              </p>
            </div>
            <Button
              onClick={() => void load(selectedSlug, false)}
              disabled={!nichesReady}
              className="gap-1.5 bg-emerald text-white hover:bg-emerald/90"
            >
              <Search className="size-4" />
              Load trends for{" "}
              {NICHES.find((n) => n.slug === selectedSlug)?.name ?? "niche"}
            </Button>
          </div>
        )}

        {!nichesReady && (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading your niches…
          </div>
        )}

        {/* Loading */}
        {loading && !snapshot && !emptyReason && (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading trends for{" "}
            {NICHES.find((n) => n.slug === selectedSlug)?.name}…
          </div>
        )}

        {/* Friendly empty states. Replaces the old red "Could not load
            trends" error banner for niches that legitimately have no
            data yet. None of these are server failures — they're
            expected onboarding / billing states. */}
        {!loading && !snapshot && emptyReason && (
          <TrendsEmptyState
            reason={emptyReason}
            nicheName={
              NICHES.find((n) => n.slug === selectedSlug)?.name ?? selectedSlug
            }
            isPremium={isPremium}
            onPinNiche={onOpenSettings}
            onUpgrade={onUpgrade}
            onRefresh={() => load(selectedSlug, true)}
            refreshing={refreshing}
          />
        )}

        {/* Content */}
        {snapshot && (
          <>
            <MacroMetrics
              snapshot={snapshot}
              priceStats={snapshot.priceStats}
            />

            <TrendsInsightsCard
              slug={snapshot.slug}
              nicheName={snapshot.name}
              snapshotKey={snapshot.scrapedAt}
              onGenerate={() => onGenerateInNiche?.(snapshot.slug)}
              onQuotaExceeded={onQuotaExceeded}
            />

            <TrendsPriceChart
              gigs={snapshot.gigs}
              median={snapshot.priceStats.median}
            />

            <KeywordDiscoveryCard
              slug={snapshot.slug}
              snapshotKey={snapshot.scrapedAt}
              onUseKeyword={(phrase) =>
                onGenerateWithKeyword?.(snapshot.slug, phrase) ??
                onGenerateInNiche?.(snapshot.slug)
              }
            />

            <Keywords keywords={snapshot.keywords} nicheName={snapshot.name} />

            <TopGigs gigs={snapshot.gigs} />

            {snapshot.scrapedAt && (
              <div className="mt-4 text-center text-[11px] text-muted-foreground">
                Last scraped {formatRelative(snapshot.scrapedAt)}
                {!snapshot.fresh && " (showing cached data — refresh failed)"}
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
}

// ---------- Subcomponents ----------

/**
 * Empty-state panel rendered when the API returned 200 + snapshot null.
 *
 * Flavors:
 *   • not_pinned          — pin CTA
 *   • out_of_trend_quota  — monthly trend scrape cap hit (also accepts
 *                           legacy out_of_credits)
 *   • no_data_yet         — retry scrape
 */
function TrendsEmptyState({
  reason,
  nicheName,
  isPremium,
  onPinNiche,
  onUpgrade,
  onRefresh,
  refreshing,
}: {
  reason: EmptyReason
  nicheName: string
  isPremium: boolean
  onPinNiche?: () => void
  onUpgrade?: () => void
  onRefresh: () => void
  refreshing: boolean
}) {
  if (reason === "not_pinned") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card/40 px-6 py-12 text-center sm:py-16">
        <div className="flex size-12 items-center justify-center rounded-full bg-emerald/10 text-emerald">
          <Star className="size-6" />
        </div>
        <div className="max-w-md">
          <h3 className="text-base font-semibold text-foreground">
            Pin {nicheName} to see live trends
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            We only scrape Fiverr for niches you&apos;ve pinned — that
            keeps spend on the niches you sell. Add this niche under
            Settings → My niches &amp; skills, then click Load trends.
          </p>
        </div>
        <Button
          onClick={onPinNiche}
          className="gap-1.5 bg-emerald text-primary-foreground hover:bg-emerald/90"
        >
          <Sparkles className="size-3.5" />
          Open Settings to pin
        </Button>
      </div>
    )
  }

  if (reason === "out_of_trend_quota" || reason === "out_of_credits") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-violet-500/30 bg-violet-500/5 px-6 py-12 text-center sm:py-16">
        <div className="flex size-12 items-center justify-center rounded-full bg-violet-500/15 text-violet-400">
          <Sparkles className="size-6" />
        </div>
        <div className="max-w-md">
          <h3 className="text-base font-semibold text-foreground">
            No cached trends for {nicheName} yet
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {isPremium
              ? "You've used all your trend scrapes this month. Upgrade your plan or wait until next month to fetch a fresh Fiverr snapshot."
              : "Free plan includes 2 trend scrapes per month. Upgrade to Pro (7) or Agency (15) to scrape this niche."}
          </p>
        </div>
        <Button
          onClick={onUpgrade}
          className="gap-1.5 bg-violet-500 text-white hover:bg-violet-500/90"
        >
          {isPremium ? "Upgrade plan" : "Upgrade to Pro"}
        </Button>
      </div>
    )
  }

  // no_data_yet — Firecrawl hasn't returned anything; offer a retry.
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card/40 px-6 py-12 text-center sm:py-16">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <BarChart3 className="size-6" />
      </div>
      <div className="max-w-md">
        <h3 className="text-base font-semibold text-foreground">
          No data for {nicheName} yet
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          We haven&apos;t scraped this niche yet. Click fetch to pull a
          fresh Fiverr snapshot — it uses 1 trend scrape from your monthly
          allotment.
        </p>
      </div>
      <Button
        onClick={onRefresh}
        disabled={refreshing}
        variant="outline"
        className="gap-1.5"
      >
        {refreshing ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Scraping…
          </>
        ) : (
          <>
            <RefreshCw className="size-3.5" />
            Fetch trends
          </>
        )}
      </Button>
    </div>
  )
}

function MacroMetrics({
  snapshot,
  priceStats,
}: {
  snapshot: NicheSnapshot
  priceStats: PriceStats
}) {
  const topRated = snapshot.gigs.filter(
    (g) => g.sellerLevel === "Top Rated" || g.sellerLevel === "Pro",
  ).length

  const ratings = snapshot.gigs
    .map((g) => g.rating)
    .filter((r): r is number => typeof r === "number")
  const avgRating =
    ratings.length === 0
      ? null
      : Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) /
        10

  const metrics = [
    {
      title: "Competing Gigs",
      value: String(snapshot.gigs.length),
      subtitle: "in this scrape",
      tone: "neutral" as const,
    },
    {
      title: "Median Price",
      value: priceStats.median != null ? `$${priceStats.median}` : "—",
      subtitle:
        priceStats.min != null && priceStats.max != null
          ? `Range $${priceStats.min}–$${priceStats.max}`
          : "no data",
      tone: "emerald" as const,
    },
    {
      title: "Avg Rating",
      value: avgRating != null ? avgRating.toFixed(1) : "—",
      subtitle: `${ratings.length} rated gigs`,
      tone: "warning" as const,
    },
    {
      title: "Elite Sellers",
      value: String(topRated),
      subtitle: "Top Rated / Pro",
      tone: "violet" as const,
    },
  ]

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:mb-6 sm:gap-4 lg:grid-cols-4">
      {metrics.map((m) => (
        <Card
          key={m.title}
          className={`border bg-card py-0 transition-colors ${
            m.tone === "emerald"
              ? "border-emerald/20"
              : m.tone === "warning"
                ? "border-warning/20"
                : m.tone === "violet"
                  ? "border-violet-500/20"
                  : "border-border"
          }`}
        >
          <CardContent className="p-3 sm:p-4">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">
              {m.title}
            </div>
            <div
              className={`mt-1 text-xl font-bold sm:text-2xl ${
                m.tone === "emerald"
                  ? "text-emerald"
                  : m.tone === "warning"
                    ? "text-warning"
                    : m.tone === "violet"
                      ? "text-violet-400"
                      : "text-foreground"
              }`}
            >
              {m.value}
            </div>
            <div className="text-xs text-muted-foreground">{m.subtitle}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Keywords({
  keywords,
  nicheName,
}: {
  keywords: KeywordCount[]
  nicheName: string
}) {
  if (keywords.length === 0) {
    return null
  }
  const max = keywords[0].count

  return (
    <Card className="mb-6 border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Flame className="size-4 text-warning" />
          Trending Keywords in {nicheName}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-wrap gap-2">
          {keywords.map((kw) => {
            const weight = kw.count / max
            return (
              <Badge
                key={kw.keyword}
                variant="secondary"
                className="cursor-default border border-border bg-secondary text-secondary-foreground"
                style={{
                  fontSize: `${0.7 + weight * 0.35}rem`,
                  opacity: 0.55 + weight * 0.45,
                }}
              >
                <Search className="mr-1 size-3" />
                {kw.keyword}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  ×{kw.count}
                </span>
              </Badge>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function TopGigs({ gigs }: { gigs: NicheGig[] }) {
  if (gigs.length === 0) {
    return null
  }
  return (
    <Card className="border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BarChart3 className="size-4 text-chart-4" />
          Top Gigs ({gigs.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <ol className="flex flex-col divide-y divide-border">
          {gigs.map((gig) => (
            <li key={gig.url} className="flex items-start gap-3 px-4 py-3">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-muted-foreground">
                {gig.position}
              </div>
              <div className="min-w-0 flex-1">
                <a
                  href={gig.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-start gap-1.5 text-sm font-medium text-foreground hover:text-emerald"
                >
                  <span className="line-clamp-2">{gig.title}</span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  {gig.price != null && (
                    <span className="font-medium text-emerald">${gig.price}</span>
                  )}
                  {gig.rating != null && (
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="size-3 fill-warning text-warning" />
                      {gig.rating.toFixed(1)}
                      {gig.reviewCount != null && (
                        <span className="text-muted-foreground/70">
                          ({gig.reviewCount})
                        </span>
                      )}
                    </span>
                  )}
                  {gig.sellerLevel && (
                    <Badge
                      variant="outline"
                      className="h-4 border-border px-1.5 py-0 text-[10px] text-muted-foreground"
                    >
                      {gig.sellerLevel}
                    </Badge>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}
