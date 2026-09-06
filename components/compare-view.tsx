"use client"

/**
 * Side-by-side comparison view (Premium feature).
 *
 * Flow:
 *   1. User pastes 2–3 Fiverr URLs (their gig in position 0, competitors
 *      in 1 and 2).
 *   2. Press Compare → POST /api/compare.
 *   3. Server returns scrape + analysis for each, plus an LLM-written
 *      verdict + per-gig wins/losses + one actionable recommendation.
 *
 * Non-premium users still see the view (so they understand what they
 * unlock), but the Compare button is locked and routes them through
 * the paywall.
 */

import { useMemo, useState, type FormEvent } from "react"
import {
  ArrowRight,
  AlertCircle,
  Award,
  Crown,
  ExternalLink,
  GitCompare,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

import type {
  ComparisonGig,
  ComparisonNarrative,
  ComparisonReport,
} from "@/lib/compare-types"

interface CompareViewProps {
  isPremium: boolean
  onUpgrade?: () => void
  onApplyToGenerator?: (recommendation: string) => void
}

const MIN_URLS = 2
const MAX_URLS = 3

export function CompareView({
  isPremium,
  onUpgrade,
  onApplyToGenerator,
}: CompareViewProps) {
  const [urls, setUrls] = useState<string[]>(["", ""])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ComparisonReport | null>(null)

  const canSubmit =
    !loading &&
    urls.filter((u) => u.trim().match(/^https?:\/\//)).length >= MIN_URLS

  const handleAddSlot = () => {
    if (urls.length < MAX_URLS) setUrls([...urls, ""])
  }
  const handleRemoveSlot = (idx: number) => {
    if (urls.length <= MIN_URLS) return
    setUrls(urls.filter((_, i) => i !== idx))
  }
  const handleChange = (idx: number, val: string) => {
    const next = [...urls]
    next[idx] = val
    setUrls(next)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!isPremium) {
      onUpgrade?.()
      return
    }
    const valid = urls.map((u) => u.trim()).filter(Boolean)
    if (valid.length < MIN_URLS) {
      setError(`Provide at least ${MIN_URLS} URLs`)
      return
    }
    setLoading(true)
    setReport(null)
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: valid }),
      })
      if (res.status === 402) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string; upgrade?: boolean }
          | null
        if (json?.upgrade) onUpgrade?.()
        throw new Error(json?.error ?? "Upgrade required")
      }
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(json?.error ?? `Request failed (${res.status})`)
      }
      const json = (await res.json()) as {
        ok: true
      } & ComparisonReport
      setReport({
        gigs: json.gigs,
        narratives: json.narratives,
        verdict: json.verdict,
        topRecommendation: json.topRecommendation,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold text-foreground sm:text-xl">
              <GitCompare className="size-5 text-emerald" />
              Side-by-side comparison
              {isPremium ? (
                <Badge className="gap-1 border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-300">
                  <Crown className="size-2.5" />
                  Pro
                </Badge>
              ) : (
                <Badge className="gap-1 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400">
                  <Crown className="size-2.5" />
                  Pro only
                </Badge>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pit your gig against 1–2 competitors and let the AI tell you
              exactly where you&apos;re losing.
            </p>
          </div>
        </div>

        {/* Input form */}
        <Card className="mb-6 border-border bg-card">
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              {urls.map((u, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${
                      i === 0
                        ? "border-emerald/40 bg-emerald/10 text-emerald"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {i === 0 ? "Your gig" : `Competitor ${i}`}
                  </Badge>
                  <Input
                    placeholder="https://www.fiverr.com/<seller>/<gig-slug>"
                    value={u}
                    onChange={(e) => handleChange(i, e.target.value)}
                    disabled={loading}
                    className="h-9 text-sm"
                  />
                  {urls.length > MIN_URLS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveSlot(i)}
                      className="size-7 text-muted-foreground hover:text-danger"
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                {urls.length < MAX_URLS && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAddSlot}
                    className="gap-1.5"
                  >
                    <Plus className="size-3.5" />
                    Add competitor
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSubmit}
                  className="ml-auto gap-1.5 bg-emerald text-primary-foreground hover:bg-emerald/90"
                >
                  {loading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <GitCompare className="size-3.5" />
                  )}
                  {isPremium ? "Compare" : "Unlock with Pro"}
                </Button>
              </div>
            </form>
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {!isPremium && !error && (
              <div className="mt-3 rounded-md border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-200">
                <div className="font-semibold text-violet-100">
                  This feature ships with Pro
                </div>
                <p className="mt-0.5 text-violet-200/80">
                  See how your gig stacks up against any 1 or 2 Fiverr
                  competitors on optimization score, click-ability,
                  buyer-trust, and pricing — plus an AI-written verdict.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-2 gap-1.5 bg-violet-500 text-white hover:bg-violet-500/90"
                  onClick={onUpgrade}
                >
                  Upgrade
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Scraping &amp; analyzing each gig... this can take 30–60 seconds.
          </div>
        )}

        {report && (
          <ComparisonResults
            report={report}
            onApplyToGenerator={onApplyToGenerator}
          />
        )}
      </div>
    </ScrollArea>
  )
}

// ---------- Results body ----------

function ComparisonResults({
  report,
  onApplyToGenerator,
}: {
  report: ComparisonReport
  onApplyToGenerator?: (recommendation: string) => void
}) {
  const metrics = useMemo(() => buildMetricRows(report.gigs), [report.gigs])

  return (
    <div className="space-y-4">
      {/* Verdict card */}
      <Card className="border-emerald/30 bg-emerald/5">
        <CardHeader className="px-5 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Award className="size-4 text-emerald" />
            AI verdict
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4 text-sm text-foreground/90">
          <p>{report.verdict}</p>
          {report.topRecommendation && (
            <div className="mt-3 rounded-md border border-emerald/30 bg-emerald/10 px-3 py-2 text-sm">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald">
                Top recommendation
              </div>
              <div className="mt-0.5 flex items-start gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-emerald" />
                <p className="flex-1 text-foreground">
                  {report.topRecommendation}
                </p>
                {onApplyToGenerator && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-[11px] text-emerald hover:bg-emerald/15"
                    onClick={() =>
                      onApplyToGenerator(report.topRecommendation)
                    }
                  >
                    Apply
                    <ArrowRight className="size-3" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-gig column cards — stack on mobile, columns from md up. */}
      <div
        className="grid grid-cols-1 gap-4 md:grid-cols-[var(--compare-cols)]"
        style={
          {
            "--compare-cols": `repeat(${report.gigs.length}, minmax(0, 1fr))`,
          } as React.CSSProperties
        }
      >
        {report.gigs.map((g, i) => (
          <GigColumn
            key={g.url}
            gig={g}
            index={i}
            narrative={report.narratives.find((n) => n.index === i)}
            isLeaderOnScore={
              i ===
              report.gigs
                .map((x) => x.analysis.optimizationScore)
                .indexOf(
                  Math.max(
                    ...report.gigs.map((x) => x.analysis.optimizationScore),
                  ),
                )
            }
          />
        ))}
      </div>

      {/* Metric table */}
      <Card className="border-border bg-card py-0">
        <CardHeader className="px-4 pb-3 pt-4">
          <CardTitle className="text-sm font-semibold">
            Metric-by-metric
          </CardTitle>
          <CardDescription>
            Best value in each row is highlighted green.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[420px] text-xs">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Metric
                  </th>
                  {report.gigs.map((g, i) => (
                    <th
                      key={g.url}
                      className="px-3 py-2 text-left font-medium text-muted-foreground"
                    >
                      {i === 0 ? "Your gig" : `Competitor ${i}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {metrics.map((row) => (
                  <tr key={row.label}>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.label}
                    </td>
                    {row.values.map((cell, i) => (
                      <td
                        key={i}
                        className={`px-3 py-2 font-semibold ${
                          row.bestIdx === i
                            ? "text-emerald"
                            : "text-foreground/90"
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- One gig column ----------

function GigColumn({
  gig,
  index,
  narrative,
  isLeaderOnScore,
}: {
  gig: ComparisonGig
  index: number
  narrative: ComparisonNarrative | undefined
  isLeaderOnScore: boolean
}) {
  const score = Math.round(gig.analysis.optimizationScore)
  return (
    <Card
      className={`flex flex-col border bg-card ${
        index === 0 ? "border-emerald/40" : "border-border"
      }`}
    >
      <CardHeader className="px-4 pb-2 pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={`text-[10px] ${
              index === 0
                ? "border-emerald/40 bg-emerald/10 text-emerald"
                : "border-border text-muted-foreground"
            }`}
          >
            {index === 0 ? "Your gig" : `Competitor ${index}`}
          </Badge>
          {isLeaderOnScore && (
            <Badge className="gap-1 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400">
              <Award className="size-2.5" />
              Leader
            </Badge>
          )}
          {gig.cached && (
            <Badge
              variant="outline"
              className="border-border text-[10px] text-muted-foreground"
            >
              Cached
            </Badge>
          )}
        </div>
        <CardTitle className="line-clamp-2 pt-2 text-sm font-semibold leading-snug text-foreground">
          {gig.scraped.title}
        </CardTitle>
        <a
          href={gig.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground"
        >
          <span className="truncate">
            {gig.url.replace(/^https?:\/\//, "")}
          </span>
          <ExternalLink className="size-3" />
        </a>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 px-4 pb-4">
        {/* Score */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Optimization
            </span>
            <span
              className={`text-2xl font-bold ${
                score >= 75
                  ? "text-emerald"
                  : score >= 50
                    ? "text-warning"
                    : "text-danger"
              }`}
            >
              {score}
              <span className="text-xs text-muted-foreground">/100</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full ${
                score >= 75
                  ? "bg-emerald"
                  : score >= 50
                    ? "bg-warning"
                    : "bg-danger"
              }`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>

        {/* Wins / losses */}
        {narrative && (
          <>
            {narrative.wins.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald">
                  <TrendingUp className="size-3" />
                  Wins
                </div>
                <ul className="space-y-1">
                  {narrative.wins.map((w, j) => (
                    <li key={j} className="text-[11px] text-foreground/90">
                      • {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {narrative.losses.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
                  <TrendingDown className="size-3" />
                  Losses
                </div>
                <ul className="space-y-1">
                  {narrative.losses.map((w, j) => (
                    <li key={j} className="text-[11px] text-foreground/90">
                      • {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-auto text-[11px] italic text-muted-foreground">
              {narrative.summary}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Metric table builder ----------

interface MetricRow {
  label: string
  values: string[]
  /** Index of the row's leader (lower is better for some metrics). */
  bestIdx: number
}

function buildMetricRows(gigs: ComparisonGig[]): MetricRow[] {
  const rows: MetricRow[] = []

  rows.push(
    bestNumberRow(
      "Optimization score",
      gigs.map((g) => g.analysis.optimizationScore),
      (n) => `${Math.round(n)}/100`,
      "high",
    ),
  )
  rows.push(
    bestNumberRow(
      "Clickability",
      gigs.map((g) => g.analysis.clickabilityPercentage),
      (n) => `${Math.round(n)}%`,
      "high",
    ),
  )
  rows.push(
    bestNumberRow(
      "Buyer trust",
      gigs.map((g) => g.analysis.buyerTrustScore),
      (n) => `${Math.round(n)}%`,
      "high",
    ),
  )
  rows.push({
    label: "Ranking potential",
    values: gigs.map((g) => g.analysis.rankingPotential),
    bestIdx: gigs.findIndex(
      (g) =>
        g.analysis.rankingPotential ===
        bestPotential(gigs.map((x) => x.analysis.rankingPotential)),
    ),
  })

  // Starting price — lower is "better" if you're a buyer, but we'll
  // flag it as best when lowest to call out price-leadership in the table.
  rows.push(
    bestNumberRow(
      "Starting price",
      gigs.map((g) => firstPackagePrice(g)),
      (n) => (n == null ? "—" : `$${n}`),
      "low",
      true,
    ),
  )

  rows.push({
    label: "Tags used",
    values: gigs.map((g) => String(g.scraped.tags.length)),
    bestIdx: gigs
      .map((g) => g.scraped.tags.length)
      .indexOf(Math.max(...gigs.map((g) => g.scraped.tags.length))),
  })

  return rows
}

function firstPackagePrice(gig: ComparisonGig): number | null {
  const prices = gig.scraped.packages
    .map((p) => p.price)
    .filter((p): p is number => typeof p === "number" && p > 0)
  if (prices.length === 0) return null
  return Math.min(...prices)
}

function bestNumberRow(
  label: string,
  values: (number | null)[],
  fmt: (n: number) => string,
  dir: "high" | "low",
  allowNull = false,
): MetricRow {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => typeof x.v === "number")
  const bestIdx = present.length
    ? present.reduce((acc, x) =>
        dir === "high"
          ? x.v > acc.v
            ? x
            : acc
          : x.v < acc.v
            ? x
            : acc,
      ).i
    : -1
  return {
    label,
    values: values.map((v) =>
      v == null ? (allowNull ? "—" : "—") : fmt(v),
    ),
    bestIdx,
  }
}

function bestPotential(arr: ("Low" | "Medium" | "High")[]): "Low" | "Medium" | "High" {
  if (arr.includes("High")) return "High"
  if (arr.includes("Medium")) return "Medium"
  return "Low"
}
