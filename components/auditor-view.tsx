"use client"

import { useState } from "react"
import {
  ArrowLeft,
  MousePointerClick,
  Printer,
  Share2,
  ShieldCheck,
  Target,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AuditPanel } from "@/components/audit-panel"
import { FunnelDiagnosticCard } from "@/components/funnel-diagnostic-card"
import { GigHealthGauge } from "@/components/gig-health-gauge"
import { OptimizationPanel } from "@/components/optimization-panel"
import { ShareModal } from "@/components/share-modal"
import { VisibilityPanel } from "@/components/visibility-panel"

import type { AnalyzeResponse } from "@/lib/analysis-types"
import { DEFAULT_GIG_CHECKLIST } from "@/lib/visibility-types"

interface AuditorViewProps {
  onBack: () => void
  data: AnalyzeResponse
}

function trustColor(score: number) {
  if (score >= 75) {
    return {
      color: "text-emerald",
      bgColor: "bg-emerald/10",
      borderColor: "border-emerald/20",
    }
  }
  if (score >= 50) {
    return {
      color: "text-warning",
      bgColor: "bg-warning/10",
      borderColor: "border-warning/20",
    }
  }
  return {
    color: "text-danger",
    bgColor: "bg-danger/10",
    borderColor: "border-danger/20",
  }
}

function rankingColor(potential: "Low" | "Medium" | "High") {
  if (potential === "High") {
    return {
      color: "text-emerald",
      bgColor: "bg-emerald/10",
      borderColor: "border-emerald/20",
    }
  }
  if (potential === "Medium") {
    return {
      color: "text-warning",
      bgColor: "bg-warning/10",
      borderColor: "border-warning/20",
    }
  }
  return {
    color: "text-danger",
    bgColor: "bg-danger/10",
    borderColor: "border-danger/20",
  }
}

export function AuditorView({ onBack, data }: AuditorViewProps) {
  const { url, scraped, analysis, id, publicSlug } = data
  const [shareOpen, setShareOpen] = useState(false)
  const [currentSlug, setCurrentSlug] = useState<string | null>(
    publicSlug ?? null,
  )

  const metrics = [
    {
      label: "Ranking Potential",
      value: analysis.rankingPotential.toUpperCase(),
      icon: Target,
      ...rankingColor(analysis.rankingPotential),
    },
    {
      label: "Clickability (CTR)",
      value: `${Math.round(analysis.clickabilityPercentage)}%`,
      icon: MousePointerClick,
      ...trustColor(analysis.clickabilityPercentage),
    },
    {
      label: "Buyer Trust",
      value: `${Math.round(analysis.buyerTrustScore)}%`,
      icon: ShieldCheck,
      ...trustColor(analysis.buyerTrustScore),
    },
  ]

  const displayUrl = url.replace(/^https?:\/\//, "")

  return (
    // Single page-level scroll. We used to lock the wrapper with
    // `md:overflow-hidden` and rely on per-panel ScrollAreas (flex-1
    // inside a sized flex column). That chain is fragile: if any
    // ancestor fails to resolve its height (which happens on some
    // viewport sizes or when long thumbnail analyses push the layout),
    // the inner ScrollArea collapses to 0 and the page becomes
    // un-scrollable. Instead, the outer wrapper scrolls vertically and
    // the panels render at their natural height side-by-side. The
    // summary bar sticks to the top so the score and back button stay
    // reachable while reading a long audit.
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Top Summary Bar — sticky so it stays visible as the page scrolls */}
      <div className="sticky top-0 z-20 border-b border-border bg-card/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-6 sm:py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
          <span className="order-3 w-full truncate text-xs text-muted-foreground sm:order-none sm:w-auto sm:flex-1">
            {displayUrl}
          </span>
          {id && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setShareOpen(true)}
              >
                <Share2 className="size-3.5" />
                Share
                {currentSlug && (
                  <span className="ml-1 inline-block size-1.5 rounded-full bg-emerald" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                onClick={() => {
                  if (currentSlug) {
                    window.open(`/audit/${currentSlug}?print=1`, "_blank")
                  } else {
                    window.print()
                  }
                }}
                title="Save this audit as a PDF"
              >
                <Printer className="size-3.5" />
                PDF
              </Button>
            </>
          )}
        </div>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
          {/* Health Score Gauge */}
          <div className="flex flex-col items-center self-center sm:self-auto">
            <GigHealthGauge
              score={Math.round(analysis.optimizationScore)}
              size={120}
            />
            <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Gig Health Score
            </span>
          </div>

          {/* Metric Badges */}
          <div className="flex w-full flex-1 flex-wrap gap-2 sm:gap-3">
            {metrics.map((m) => (
              <div
                key={m.label}
                className={`flex flex-1 items-center gap-2.5 rounded-lg border ${m.borderColor} ${m.bgColor} px-3 py-2 sm:flex-none sm:px-4 sm:py-2.5`}
              >
                <m.icon className={`size-4 ${m.color}`} />
                <div>
                  <div className="text-[10px] text-muted-foreground">{m.label}</div>
                  <div className={`text-sm font-bold ${m.color}`}>{m.value}</div>
                </div>
              </div>
            ))}
            <Badge variant="outline" className="hidden self-start border-border text-muted-foreground text-[10px] md:inline-flex">
              Updated just now
            </Badge>
          </div>
        </div>
      </div>

      {/* Funnel diagnostic — sits above the split panels. Collapsed by
          default so users without seller-analytics data handy can
          skip straight to the AI audit; expanded, it prompts for the
          7-day impressions/clicks/orders and surfaces which stage of
          the funnel (visibility / CTR / conversion) is the actual
          bottleneck. The 2026 algorithm rewards single-stage fixes,
          not blanket rewrites — diagnose first, then act. */}
      <div className="border-b border-border p-4 md:p-6">
        <FunnelDiagnosticCard />
      </div>

      {(analysis.answerReadinessScore != null ||
        analysis.geoCiteScore != null ||
        (analysis.visibilityChecklist?.length ?? 0) > 0 ||
        (analysis.suggestedFaqs?.length ?? 0) > 0) && (
        <div className="border-b border-border p-4 md:p-6">
          <VisibilityPanel
            answerReadinessScore={analysis.answerReadinessScore}
            geoCiteScore={analysis.geoCiteScore}
            answerReadinessNotes={analysis.answerReadinessNotes}
            proofQuotes={analysis.proofQuotes}
            faqs={analysis.suggestedFaqs}
            checklist={
              analysis.visibilityChecklist?.length
                ? analysis.visibilityChecklist
                : DEFAULT_GIG_CHECKLIST
            }
            faqTitle="Suggested gig FAQs"
          />
        </div>
      )}

      {/* Split-Screen Panels — stack on mobile, side-by-side from md up.
          No more `md:overflow-hidden` / `flex-1` height constraints here.
          Each panel renders at natural height and the outer wrapper
          scrolls. `items-start` keeps the two columns top-aligned when
          their content heights differ (e.g. long optimized description
          vs. short critiques list). */}
      <div className="flex flex-col md:flex-row md:items-start">
        <div className="w-full border-b border-border md:w-1/2 md:border-b-0 md:border-r">
          <AuditPanel
            seoCritiques={analysis.seoCritiques}
            roastComments={analysis.roastComments}
            thumbnailUrl={scraped.thumbnailUrl ?? null}
            thumbnailAnalysis={analysis.thumbnail ?? null}
          />
        </div>

        <div className="w-full md:w-1/2">
          <OptimizationPanel scraped={scraped} analysis={analysis} />
        </div>
      </div>

      {id && (
        <ShareModal
          open={shareOpen}
          onOpenChange={setShareOpen}
          analysisId={id}
          initialPublicSlug={currentSlug}
          onChange={setCurrentSlug}
        />
      )}
    </div>
  )
}
