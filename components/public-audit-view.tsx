"use client"

/**
 * Public, unauthenticated audit viewer rendered at `/audit/<slug>`.
 *
 * Reuses the same audit/optimization/thumbnail building blocks as the
 * authed AuditorView, but wraps them with a marketing header + footer
 * (so every share doubles as a top-of-funnel touchpoint) and a print
 * button for one-click PDF export.
 *
 * `?print=1` auto-triggers the browser's print dialog on mount, which is
 * what the "Download PDF" CTA in the share modal links to.
 */

import { useEffect } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  ArrowRight,
  BarChart3,
  MousePointerClick,
  Printer,
  ShieldCheck,
  Target,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AuditPanel } from "@/components/audit-panel"
import { GigHealthGauge } from "@/components/gig-health-gauge"
import { OptimizationPanel } from "@/components/optimization-panel"
import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"

export interface PublicAuditViewProps {
  url: string
  scraped: ScrapedGig
  analysis: GigAnalysis
  sharedAt: string | null
}

function trustTone(score: number) {
  if (score >= 75)
    return {
      color: "text-emerald",
      bgColor: "bg-emerald/10",
      borderColor: "border-emerald/20",
    }
  if (score >= 50)
    return {
      color: "text-warning",
      bgColor: "bg-warning/10",
      borderColor: "border-warning/20",
    }
  return {
    color: "text-danger",
    bgColor: "bg-danger/10",
    borderColor: "border-danger/20",
  }
}

function rankingTone(potential: "Low" | "Medium" | "High") {
  if (potential === "High")
    return {
      color: "text-emerald",
      bgColor: "bg-emerald/10",
      borderColor: "border-emerald/20",
    }
  if (potential === "Medium")
    return {
      color: "text-warning",
      bgColor: "bg-warning/10",
      borderColor: "border-warning/20",
    }
  return {
    color: "text-danger",
    bgColor: "bg-danger/10",
    borderColor: "border-danger/20",
  }
}

export function PublicAuditView({
  url,
  scraped,
  analysis,
  sharedAt,
}: PublicAuditViewProps) {
  const searchParams = useSearchParams()
  const wantsPrint = searchParams?.get("print") === "1"

  useEffect(() => {
    if (!wantsPrint) return
    // Wait a tick so React paints first, otherwise some browsers print a
    // blank initial frame.
    const t = setTimeout(() => window.print(), 600)
    return () => clearTimeout(t)
  }, [wantsPrint])

  const metrics = [
    {
      label: "Ranking Potential",
      value: analysis.rankingPotential.toUpperCase(),
      icon: Target,
      ...rankingTone(analysis.rankingPotential),
    },
    {
      label: "Clickability (CTR)",
      value: `${Math.round(analysis.clickabilityPercentage)}%`,
      icon: MousePointerClick,
      ...trustTone(analysis.clickabilityPercentage),
    },
    {
      label: "Buyer Trust",
      value: `${Math.round(analysis.buyerTrustScore)}%`,
      icon: ShieldCheck,
      ...trustTone(analysis.buyerTrustScore),
    },
  ]

  const displayUrl = url.replace(/^https?:\/\//, "")
  // Pin to "en-US" so SSR (Node) and hydration (browser) agree. Without an
  // explicit locale, Node defaults to en-US ("May 30, 2026") while the
  // browser uses the user's locale (e.g. en-GB → "30 May 2026"), and the
  // resulting text-node mismatch trips a hydration error. This page is a
  // public, SEO-indexed share artefact, so a stable, unambiguous format
  // is the right call regardless of viewer locale.
  const sharedDate = sharedAt
    ? new Date(sharedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MarketingHeader />

      <main className="flex flex-1 flex-col">
        {/* Summary bar */}
        <div className="border-b border-border bg-card/50 px-6 py-4 print:bg-transparent">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs text-muted-foreground">
                {displayUrl}
              </span>
              {sharedDate && (
                <span className="text-[10px] text-muted-foreground">
                  Audited on {sharedDate}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 print:hidden"
              onClick={() => window.print()}
            >
              <Printer className="size-3.5" />
              Save as PDF
            </Button>
          </div>
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <div className="flex flex-col items-center">
              <GigHealthGauge
                score={Math.round(analysis.optimizationScore)}
                size={120}
              />
              <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Gig Health Score
              </span>
            </div>
            <div className="flex flex-1 flex-wrap gap-3">
              {metrics.map((m) => (
                <div
                  key={m.label}
                  className={`flex items-center gap-2.5 rounded-lg border ${m.borderColor} ${m.bgColor} px-4 py-2.5`}
                >
                  <m.icon className={`size-4 ${m.color}`} />
                  <div>
                    <div className="text-[10px] text-muted-foreground">
                      {m.label}
                    </div>
                    <div className={`text-sm font-bold ${m.color}`}>
                      {m.value}
                    </div>
                  </div>
                </div>
              ))}
              <Badge
                variant="outline"
                className="self-start border-emerald/40 text-emerald text-[10px]"
              >
                Public audit · JobFlow AI
              </Badge>
            </div>
          </div>
        </div>

        {/* Split-screen panels — same as the private auditor.
            Each panel renders at natural height; the page scrolls. The
            thumbnail analysis lives inside the AuditPanel column so a
            tall thumbnail doesn't push the optimization column off
            screen. */}
        <div className="flex flex-col lg:flex-row lg:items-start">
          <div className="border-b border-border lg:w-1/2 lg:border-b-0 lg:border-r">
            <AuditPanel
              seoCritiques={analysis.seoCritiques}
              roastComments={analysis.roastComments}
              thumbnailUrl={scraped.thumbnailUrl ?? null}
              thumbnailAnalysis={analysis.thumbnail ?? null}
            />
          </div>
          <div className="lg:w-1/2">
            <OptimizationPanel scraped={scraped} analysis={analysis} />
          </div>
        </div>

        <BottomCta />
      </main>

      <PublicFooter />
    </div>
  )
}

// ---------- Top-of-page marketing band ----------

function MarketingHeader() {
  return (
    <header className="border-b border-border bg-background/80 print:hidden">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald text-primary-foreground">
            <BarChart3 className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            JobFlow AI
          </span>
        </Link>
        <Button
          asChild
          size="sm"
          className="gap-1.5 bg-emerald text-primary-foreground hover:bg-emerald/90"
        >
          <Link href="/auth?mode=signup">
            Audit your gig free
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </header>
  )
}

// ---------- Bottom-of-page CTA ----------

function BottomCta() {
  return (
    <section className="border-t border-border bg-card/40 px-6 py-12 print:hidden">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">
          Ready to optimize Fiverr — and win on Upwork?
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Audit your own Fiverr gig free, or paste an Upwork job post for a
          tailored proposal. No credit card.
        </p>
        <Button
          asChild
          size="lg"
          className="mt-6 gap-2 bg-emerald text-primary-foreground hover:bg-emerald/90"
        >
          <Link href="/auth?mode=signup">
            Start free
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  )
}

function PublicFooter() {
  return (
    <footer className="border-t border-border py-6 text-xs text-muted-foreground print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 md:flex-row">
        <div className="flex items-center gap-2">
          <div className="flex size-5 items-center justify-center rounded bg-emerald text-primary-foreground">
            <BarChart3 className="size-3" />
          </div>
          <span className="font-medium text-foreground">JobFlow AI</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
        <span>Not affiliated with Fiverr Inc. or Upwork Global Inc.</span>
      </div>
    </footer>
  )
}
