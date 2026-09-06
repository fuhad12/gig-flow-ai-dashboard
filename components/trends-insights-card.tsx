"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Sparkles,
  Loader2,
  RefreshCw,
  AlertCircle,
  Zap,
  TrendingUp,
  ShieldAlert,
  Coins,
  Target,
  Wand2,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

import type {
  InsightType,
  NicheInsight,
  NicheInsights,
  InsightsResponse,
} from "@/lib/insights-types"

interface TrendsInsightsCardProps {
  slug: string
  nicheName: string
  /** Reset key — bump when underlying snapshot changes (e.g. after refresh). */
  snapshotKey: string | null
  onGenerate: () => void
  /**
   * Called when the insights endpoint returns 402 (user is out of monthly
   * AI credits). Pops the paywall — cached insights stay readable;
   * regenerate is what's blocked.
   */
  onQuotaExceeded?: () => void
}

const TYPE_META: Record<
  InsightType,
  {
    label: string
    icon: typeof Zap
    border: string
    bg: string
    text: string
  }
> = {
  opportunity: {
    label: "Opportunity",
    icon: Zap,
    border: "border-emerald/30",
    bg: "bg-emerald/5",
    text: "text-emerald",
  },
  trend: {
    label: "Trend",
    icon: TrendingUp,
    border: "border-chart-4/30",
    bg: "bg-chart-4/5",
    text: "text-chart-4",
  },
  warning: {
    label: "Warning",
    icon: ShieldAlert,
    border: "border-warning/30",
    bg: "bg-warning/5",
    text: "text-warning",
  },
  pricing: {
    label: "Pricing",
    icon: Coins,
    border: "border-violet-500/30",
    bg: "bg-violet-500/5",
    text: "text-violet-400",
  },
}

export function TrendsInsightsCard({
  slug,
  nicheName,
  snapshotKey,
  onGenerate,
  onQuotaExceeded,
}: TrendsInsightsCardProps) {
  const [insights, setInsights] = useState<NicheInsights | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cached, setCached] = useState(false)

  const load = useCallback(
    async (regenerate = false) => {
      if (regenerate) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const url = `/api/trends/${slug}/insights${regenerate ? "?regenerate=true" : ""}`
        const res = await fetch(url)
        if (res.status === 402) {
          onQuotaExceeded?.()
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null
          throw new Error(data?.error ?? "Monthly AI credit limit reached")
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null
          throw new Error(
            data?.error ?? `Request failed with status ${res.status}`,
          )
        }
        const data = (await res.json()) as InsightsResponse
        setInsights(data.insights)
        setCached(data.cached)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [slug, onQuotaExceeded],
  )

  // Auto-load when slug or underlying snapshot changes.
  useEffect(() => {
    setInsights(null)
    if (snapshotKey) load(false)
  }, [slug, snapshotKey, load])

  return (
    <Card className="mb-6 border-emerald/20 bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="size-4 text-emerald" />
            AI Niche Insights
            {cached && insights && (
              <Badge
                variant="outline"
                className="ml-1 border-border text-[10px] text-muted-foreground"
              >
                cached
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => load(true)}
              disabled={loading || refreshing}
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              title="Regenerate insights (costs an OpenAI call)"
            >
              {refreshing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Regenerate
            </Button>
            <Button
              size="sm"
              onClick={onGenerate}
              className="h-7 gap-1 bg-emerald px-2 text-[11px] text-primary-foreground hover:bg-emerald/90"
            >
              <Wand2 className="size-3" />
              Generate gig
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading && !insights && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Analyzing {nicheName} market...
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {insights && (
          <div className="space-y-4">
            {/* Headline */}
            <p className="text-base font-medium leading-relaxed text-foreground">
              {insights.headline}
            </p>

            {/* Insight chips */}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {insights.insights.map((ins, i) => (
                <InsightChip key={i} insight={ins} />
              ))}
            </div>

            {/* Competitor angle */}
            <div className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Target className="size-3" />
                Competitor Angle
              </div>
              <p className="text-sm text-foreground/90">
                {insights.competitorAngle}
              </p>
            </div>

            {/* Recommended action */}
            <div className="rounded-md border border-emerald/30 bg-emerald/10 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald">
                <Zap className="size-3" />
                Your Next Move
              </div>
              <p className="text-sm text-foreground">
                {insights.recommendedAction}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function InsightChip({ insight }: { insight: NicheInsight }) {
  const meta = TYPE_META[insight.type]
  const Icon = meta.icon
  return (
    <div
      className={`flex gap-2.5 rounded-md border ${meta.border} ${meta.bg} p-3`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${meta.text}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${meta.text}`}>
            {meta.label}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {insight.title}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {insight.body}
        </p>
      </div>
    </div>
  )
}
