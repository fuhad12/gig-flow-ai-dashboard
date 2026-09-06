"use client"

/**
 * Funnel diagnostic — the "is this a visibility, CTR, or conversion
 * problem?" gate that anchors the audit flow.
 *
 * Fiverr's 2026 algorithm runs every gig through three sequential
 * filters: impressions → clicks → orders. The right optimisation
 * depends entirely on which filter is actually leaking buyers:
 *
 *   - Few impressions       → relevance signal (keywords / category)
 *   - Impressions, few clicks → presentation (thumbnail / title)
 *   - Clicks, few orders    → trust (pricing / packages / description)
 *
 * "Just rewrite everything" is the wrong default — it triggers Fiverr's
 * 7-28 day re-evaluation window for every field at once and makes the
 * impact unattributable. The seller-community framework (and the
 * Fiverr Community blog) is unambiguous: diagnose first, then fix the
 * narrowest possible thing.
 *
 * The card is collapsed by default so users without analytics handy
 * can ignore it and go straight to the existing AI audit. Once they
 * fill in their numbers, the panel below auto-highlights the relevant
 * tab and tones the others amber.
 */

import { useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  Eye,
  MousePointerClick,
  PackageCheck,
  Sparkles,
  Target,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * What this gig's seller-analytics funnel is bottlenecked on.
 * Surfaced to the parent so the optimisation panel can tone its tabs
 * to match the diagnosis (the leaking stage gets emerald, the rest go
 * amber to discourage premature edits there).
 */
export type FunnelStage = "visibility" | "ctr" | "conversion" | "healthy"

interface FunnelDiagnosticCardProps {
  /** Bubble the diagnosis up so the optimisation panel can re-tone. */
  onDiagnosis?: (stage: FunnelStage | null) => void
}

interface Stats {
  impressions: number
  clicks: number
  orders: number
}

const EMPTY: Stats = { impressions: 0, clicks: 0, orders: 0 }

// Thresholds calibrated against the 2026 seller-community consensus.
// Numbers vary widely by niche and seller level — these are deliberately
// generous defaults that flag obvious problems rather than borderline
// ones. Tune later with real data.
const VISIBILITY_FLOOR_PER_WEEK = 100
const CTR_FLOOR = 0.02 // 2%
const CONVERSION_FLOOR = 0.03 // 3% of clicks

function diagnose(s: Stats): FunnelStage | null {
  if (s.impressions <= 0) return null
  if (s.impressions < VISIBILITY_FLOOR_PER_WEEK) return "visibility"
  const ctr = s.clicks / s.impressions
  if (ctr < CTR_FLOOR) return "ctr"
  if (s.clicks <= 0) return "ctr"
  const conv = s.orders / Math.max(1, s.clicks)
  if (conv < CONVERSION_FLOOR) return "conversion"
  return "healthy"
}

export function FunnelDiagnosticCard({ onDiagnosis }: FunnelDiagnosticCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [stats, setStats] = useState<Stats>(EMPTY)

  const diagnosis = useMemo(() => diagnose(stats), [stats])

  const handleField = (field: keyof Stats) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const next = Math.max(0, Number(e.target.value) || 0)
    const newStats = { ...stats, [field]: next }
    setStats(newStats)
    onDiagnosis?.(diagnose(newStats))
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="cursor-pointer pb-3" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Target className="size-4 text-emerald" />
            Diagnose your funnel first
            {diagnosis && diagnosis !== "healthy" && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                {labelFor(diagnosis)} problem
              </span>
            )}
            {diagnosis === "healthy" && (
              <span className="rounded-full bg-emerald/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald">
                Healthy funnel
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
          >
            {expanded ? (
              <>
                <ChevronUp className="size-3.5" />
                Hide
              </>
            ) : (
              <>
                <ChevronDown className="size-3.5" />
                Add 7-day stats
              </>
            )}
          </Button>
        </div>
        {!expanded && (
          <p className="mt-1 text-xs text-muted-foreground">
            Most de-ranking is fixed by editing the RIGHT stage of the
            funnel, not everything at once. Paste your last 7 days of
            Seller Analytics so the AI can point you at the one change
            most likely to actually move the needle.
          </p>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FunnelField
              icon={<Eye className="size-3.5" />}
              label="Impressions"
              value={stats.impressions}
              onChange={handleField("impressions")}
              hint="last 7 days"
            />
            <FunnelField
              icon={<MousePointerClick className="size-3.5" />}
              label="Clicks"
              value={stats.clicks}
              onChange={handleField("clicks")}
              hint="last 7 days"
            />
            <FunnelField
              icon={<PackageCheck className="size-3.5" />}
              label="Orders"
              value={stats.orders}
              onChange={handleField("orders")}
              hint="last 7 days"
            />
          </div>

          {diagnosis && <DiagnosisPanel stats={stats} stage={diagnosis} />}

          {!diagnosis && (
            <p className="text-xs text-muted-foreground">
              Find these in <span className="font-medium">Fiverr →
              Selling → Analytics → Performance</span>, set the date
              range to the last 7 days, and copy the numbers across.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  )
}

interface FunnelFieldProps {
  icon: React.ReactNode
  label: string
  value: number
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  hint: string
}

function FunnelField({ icon, label, value, onChange, hint }: FunnelFieldProps) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
        <span className="text-[10px] opacity-70">({hint})</span>
      </Label>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={value || ""}
        onChange={onChange}
        placeholder="0"
        className="h-8 text-sm"
      />
    </div>
  )
}

function DiagnosisPanel({ stats, stage }: { stats: Stats; stage: FunnelStage }) {
  const ctr = stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0
  const conv = stats.clicks > 0 ? (stats.orders / stats.clicks) * 100 : 0

  if (stage === "healthy") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald/30 bg-emerald/5 p-3 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald" />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="text-sm font-semibold text-emerald">
            Your funnel is healthy — be cautious about editing.
          </p>
          <p>
            CTR {ctr.toFixed(1)}% · Conversion {conv.toFixed(1)}%. Every
            edit triggers Fiverr&apos;s 7-28 day re-evaluation and can
            temporarily drop a ranking gig. If the gig isn&apos;t broken,
            don&apos;t aggressively rewrite it. Test changes on a new gig
            instead.
          </p>
        </div>
      </div>
    )
  }

  const content =
    stage === "visibility"
      ? {
          title: "Visibility bottleneck",
          metric: `Only ${stats.impressions} impressions in 7 days — Fiverr isn't surfacing your gig.`,
          fix: "Fix the relevance signal: tags + title. Keep description, pricing, and thumbnail untouched.",
          focusTab: "tags / title",
        }
      : stage === "ctr"
        ? {
            title: "CTR (click-through) bottleneck",
            metric: `CTR is ${ctr.toFixed(1)}% — buyers see your gig but don't click.`,
            fix: "Fix presentation: thumbnail first, then title hook. Don't touch description or tags.",
            focusTab: "title",
          }
        : {
            title: "Conversion bottleneck",
            metric: `Conversion is ${conv.toFixed(1)}% — buyers click but don't order.`,
            fix: "Fix trust signals: pricing/packages, then description. Tags and title are fine.",
            focusTab: "description",
          }

  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
      <p className="text-sm font-semibold">{content.title}</p>
      <p className="text-xs">{content.metric}</p>
      <p className="text-xs">
        <span className="font-semibold">What to change:</span> {content.fix}
      </p>
      <p className="text-[10px] uppercase tracking-wider opacity-80">
        Focus the optimisation panel on:{" "}
        <span className="font-semibold">{content.focusTab}</span>
      </p>
    </div>
  )
}

function labelFor(stage: FunnelStage): string {
  switch (stage) {
    case "visibility":
      return "Visibility"
    case "ctr":
      return "CTR"
    case "conversion":
      return "Conversion"
    case "healthy":
      return "Healthy"
  }
}
