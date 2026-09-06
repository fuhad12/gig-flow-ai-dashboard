"use client"

import { useState, type FormEvent } from "react"
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Eye,
  MousePointerClick,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Target,
  Crosshair,
  ShieldAlert,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

import type {
  CompetitionDifficulty,
  Confidence,
  ImprovementLever,
  KeyFactor,
  LeverImpact,
  PredictedRange,
  PredictResponse,
} from "@/lib/prediction-types"

interface PredictViewProps {
  /**
   * Called before the request is sent. Returns `false` when the user has
   * no remaining credits (and opens the paywall as a side-effect), `true`
   * to proceed. Avoids the user waiting on a ~60s LLM call that the
   * server is going to 402 anyway.
   */
  onPredictStart?: () => boolean
  onQuotaExceeded?: () => void
  /**
   * Called after a fresh prediction (cache miss) so the dashboard can bump
   * its live credit counter. Cached predictions do NOT bump the counter
   * because the server doesn't burn a credit on a cache hit.
   */
  onCreditUsed?: () => void
}

export function PredictView({
  onPredictStart,
  onQuotaExceeded,
  onCreditUsed,
}: PredictViewProps) {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PredictResponse | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!url.trim().match(/^https?:\/\//)) {
      setError("Paste a full Fiverr gig URL starting with https://")
      return
    }
    if (onPredictStart && !onPredictStart()) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (res.status === 402) {
        onQuotaExceeded?.()
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(data?.error ?? "Monthly limit reached")
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      const data = (await res.json()) as PredictResponse
      setResult(data)
      // Only burn a credit on the live counter when the server actually
      // ran a fresh analyze (cache miss). A pure cache hit costs nothing.
      if (!data.analysisCached) onCreditUsed?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        {/* Header */}
        <div className="mb-5 sm:mb-6">
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
            <Target className="size-5 text-emerald sm:size-6" />
            Conversion Prediction Engine
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Forecast a gig&apos;s realistic monthly funnel and learn exactly
            which levers move the needle.
          </p>
        </div>

        {/* Form */}
        <Card className="mb-6 border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Paste your Fiverr gig URL</CardTitle>
            <CardDescription>
              We&apos;ll scrape, analyze, then forecast impressions, clicks,
              and orders.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="predict-url" className="sr-only">
                  Fiverr gig URL
                </Label>
                <Input
                  id="predict-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://www.fiverr.com/username/gig-slug"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="bg-background"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full gap-2 bg-emerald text-primary-foreground hover:bg-emerald/90 sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Predicting...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Run prediction
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && !result && (
          <Card className="border-border bg-card">
            <CardContent className="flex items-center gap-3 py-12">
              <Loader2 className="size-5 animate-spin text-emerald" />
              <span className="text-sm text-muted-foreground">
                Scraping → analyzing → forecasting. Usually 20–40 seconds.
              </span>
            </CardContent>
          </Card>
        )}

        {result && <ResultDisplay data={result} />}
      </div>
    </ScrollArea>
  )
}

// ---------- Result ----------

function ResultDisplay({ data }: { data: PredictResponse }) {
  const { prediction, scraped, analysis } = data

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <Card className="border-emerald/30 bg-emerald/5 py-0">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-emerald">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald">
                Verdict
              </div>
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {prediction.summary}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{scraped.sourceUrl}</span>
                {data.analysisCached && (
                  <Badge
                    variant="outline"
                    className="border-border text-[10px] text-muted-foreground"
                  >
                    audit cached
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top metrics row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          label="Niche Fit"
          value={`${Math.round(prediction.nicheFitScore)}`}
          suffix="/100"
          tone={scoreTone(prediction.nicheFitScore)}
          icon={<Crosshair className="size-4" />}
        />
        <CompetitionCard difficulty={prediction.competitionDifficulty} />
        <ConfidenceCard
          confidence={prediction.confidenceLevel}
          analysisScore={analysis.optimizationScore}
        />
      </div>

      {/* Funnel */}
      <FunnelChart
        impressions={prediction.predictedImpressions}
        clicks={prediction.predictedClicks}
        orders={prediction.predictedOrders}
        ctrPercent={prediction.ctrPercent}
        conversionPercent={prediction.conversionRatePercent}
      />

      {/* Key factors */}
      <Card className="border-border bg-card py-0">
        <CardHeader className="px-4 pb-3 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Target className="size-4 text-emerald" />
            What&apos;s driving the prediction
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {prediction.keyFactors.map((f, i) => (
              <FactorChip key={i} factor={f} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Improvement levers */}
      <Card className="border-emerald/20 bg-card py-0">
        <CardHeader className="px-4 pb-3 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-emerald" />
            Levers to pull, ranked by impact
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ul className="space-y-2">
            {[...prediction.improvementLevers]
              .sort((a, b) => impactWeight(b.impact) - impactWeight(a.impact))
              .map((lever, i) => (
                <LeverRow key={i} lever={lever} index={i} />
              ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Helpers / subcomponents ----------

function scoreTone(score: number): Tone {
  if (score >= 75) return "emerald"
  if (score >= 50) return "warning"
  return "danger"
}

type Tone = "emerald" | "warning" | "danger" | "neutral" | "violet"

const TONE_CLASSES: Record<Tone, { border: string; bg: string; text: string }> = {
  emerald: {
    border: "border-emerald/30",
    bg: "bg-emerald/10",
    text: "text-emerald",
  },
  warning: {
    border: "border-warning/30",
    bg: "bg-warning/10",
    text: "text-warning",
  },
  danger: {
    border: "border-danger/30",
    bg: "bg-danger/10",
    text: "text-danger",
  },
  neutral: {
    border: "border-border",
    bg: "bg-secondary/30",
    text: "text-foreground",
  },
  violet: {
    border: "border-violet-500/30",
    bg: "bg-violet-500/10",
    text: "text-violet-400",
  },
}

function MetricCard({
  label,
  value,
  suffix,
  tone,
  icon,
}: {
  label: string
  value: string
  suffix?: string
  tone: Tone
  icon: React.ReactNode
}) {
  const t = TONE_CLASSES[tone]
  return (
    <Card className={`border ${t.border} bg-card py-0`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className={t.text}>{icon}</span>
          {label}
        </div>
        <div className={`mt-1 text-3xl font-bold ${t.text}`}>
          {value}
          {suffix && (
            <span className="ml-0.5 text-sm font-normal text-muted-foreground">
              {suffix}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function CompetitionCard({
  difficulty,
}: {
  difficulty: CompetitionDifficulty
}) {
  const tone: Tone =
    difficulty === "Low"
      ? "emerald"
      : difficulty === "Medium"
        ? "warning"
        : difficulty === "High"
          ? "danger"
          : "violet" // Saturated
  return (
    <MetricCard
      label="Competition"
      value={difficulty}
      tone={tone}
      icon={<ShieldAlert className="size-4" />}
    />
  )
}

function ConfidenceCard({
  confidence,
  analysisScore,
}: {
  confidence: Confidence
  analysisScore: number
}) {
  const tone: Tone =
    confidence === "High" ? "emerald" : confidence === "Medium" ? "warning" : "danger"
  return (
    <Card className={`border ${TONE_CLASSES[tone].border} bg-card py-0`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className={TONE_CLASSES[tone].text}>
            <Sparkles className="size-4" />
          </span>
          Confidence
        </div>
        <div className={`mt-1 text-3xl font-bold ${TONE_CLASSES[tone].text}`}>
          {confidence}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Audit score {Math.round(analysisScore)}/100
        </div>
      </CardContent>
    </Card>
  )
}

function FunnelChart({
  impressions,
  clicks,
  orders,
  ctrPercent,
  conversionPercent,
}: {
  impressions: PredictedRange
  clicks: PredictedRange
  orders: PredictedRange
  ctrPercent: number
  conversionPercent: number
}) {
  // Bar widths scaled to impressions = 100%.
  const maxBase = Math.max(1, impressions.mid)
  const widthFor = (n: number) => Math.max(8, (n / maxBase) * 100) // floor 8% so bar is visible

  const stages: Array<{
    label: string
    range: PredictedRange
    icon: React.ReactNode
    tone: Tone
  }> = [
    {
      label: "Monthly Impressions",
      range: impressions,
      icon: <Eye className="size-4" />,
      tone: "neutral",
    },
    {
      label: "Monthly Clicks",
      range: clicks,
      icon: <MousePointerClick className="size-4" />,
      tone: "violet",
    },
    {
      label: "Monthly Orders",
      range: orders,
      icon: <ShoppingCart className="size-4" />,
      tone: "emerald",
    },
  ]

  return (
    <Card className="border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="size-4 text-emerald" />
          Predicted Funnel (monthly)
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">
            CTR ~{ctrPercent.toFixed(1)}% · Conv ~{conversionPercent.toFixed(1)}%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-3">
          {stages.map((s, i) => {
            const t = TONE_CLASSES[s.tone]
            return (
              <div key={s.label}>
                <div className="mb-1 flex items-center gap-2">
                  <span className={t.text}>{s.icon}</span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {s.label}
                  </span>
                  <span className="ml-auto text-sm font-bold text-foreground">
                    ~{formatNumber(s.range.mid)}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      ({formatNumber(s.range.low)}–{formatNumber(s.range.high)})
                    </span>
                  </span>
                </div>
                <div className="h-7 w-full overflow-hidden rounded-md bg-secondary/40">
                  <div
                    className={`flex h-full items-center justify-end px-2 ${t.bg} ${t.border} border-r-2`}
                    style={{ width: `${widthFor(s.range.mid)}%` }}
                  >
                    <span className={`text-[10px] font-semibold ${t.text}`}>
                      {i === 0
                        ? "100%"
                        : i === 1
                          ? `${ctrPercent.toFixed(1)}%`
                          : `${(ctrPercent * (conversionPercent / 100)).toFixed(2)}% of impr.`}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Ranges reflect uncertainty. The middle estimate is your most likely
          outcome holding the gig steady for ~30 days.
        </p>
      </CardContent>
    </Card>
  )
}

function FactorChip({ factor }: { factor: KeyFactor }) {
  const tone: Tone =
    factor.direction === "positive"
      ? "emerald"
      : factor.direction === "negative"
        ? "danger"
        : "neutral"
  const t = TONE_CLASSES[tone]
  const Icon =
    factor.direction === "positive"
      ? TrendingUp
      : factor.direction === "negative"
        ? TrendingDown
        : Minus
  return (
    <div className={`flex gap-2.5 rounded-md border ${t.border} ${t.bg} p-3`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${t.text}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {factor.factor}
          </span>
          <Badge
            variant="outline"
            className={`ml-auto border-border text-[9px] uppercase ${t.text}`}
          >
            {factor.weight}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {factor.note}
        </p>
      </div>
    </div>
  )
}

function LeverRow({
  lever,
  index,
}: {
  lever: ImprovementLever
  index: number
}) {
  const tone: Tone =
    lever.impact === "High" ? "emerald" : lever.impact === "Medium" ? "warning" : "neutral"
  const t = TONE_CLASSES[tone]
  return (
    <li
      className={`flex items-start gap-3 rounded-md border ${t.border} ${t.bg} p-3`}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-xs font-bold text-foreground">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {lever.lever}
          </span>
          <Badge
            variant="outline"
            className={`border-border text-[10px] ${t.text}`}
          >
            {lever.impact} impact
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {lever.projectedLift}
        </p>
      </div>
    </li>
  )
}

function impactWeight(i: LeverImpact): number {
  return i === "High" ? 3 : i === "Medium" ? 2 : 1
}

function formatNumber(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  }
  return String(Math.round(n))
}
