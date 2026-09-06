"use client"

import { useMemo, useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Copy, Check, Info, Sparkles } from "lucide-react"

import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"
import { classifyLength, FIVERR, type LengthTone } from "@/lib/fiverr-limits"
import {
  FiverrWarningDialog,
  shouldShowFiverrWarning,
} from "@/components/fiverr-warning-dialog"

interface OptimizationPanelProps {
  scraped: ScrapedGig
  analysis: GigAnalysis
}

type TabKey = "title" | "description" | "tags"

interface OptimizationEntry {
  before: string
  after: string
}

export function OptimizationPanel({
  scraped,
  analysis,
}: OptimizationPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("title")
  const [copiedTab, setCopiedTab] = useState<TabKey | null>(null)

  // Pending copy gated by the Fiverr edit-cooldown warning. When the
  // user clicks Copy for the first time in a session, we stash what
  // they're about to do here and open the warning dialog; confirming
  // the dialog flushes this to the clipboard.
  const [pendingCopy, setPendingCopy] = useState<{
    text: string
    tab: TabKey
  } | null>(null)

  const optimizations: Record<TabKey, OptimizationEntry> = useMemo(
    () => ({
      title: {
        before: scraped.title,
        after: analysis.optimizedTitle,
      },
      description: {
        before: scraped.description,
        after: analysis.optimizedDescription,
      },
      tags: {
        before: scraped.tags.join(", "),
        after: analysis.optimizedTags.join(", "),
      },
    }),
    [scraped, analysis],
  )

  // Single-element edit mode. We track the most recent tab whose
  // optimized text was copied to the clipboard this session, then
  // surface a yellow inline warning on the OTHER tabs telling the
  // user to wait 7-14 days before applying a second change.
  //
  // The 2026 Fiverr algorithm needs stable signals to attribute
  // ranking changes to a specific edit. Changing multiple fields at
  // once makes the impact unattributable AND extends the cumulative
  // re-evaluation period. Per Fiverr's own community blog: "Make one
  // change at a time, wait at least 3-4 weeks, and evaluate the
  // impact before making another change."
  const [appliedTab, setAppliedTab] = useState<TabKey | null>(null)

  const copyToClipboard = async (text: string, tab: TabKey) => {
    await navigator.clipboard.writeText(text)
    setCopiedTab(tab)
    setAppliedTab(tab)
    setTimeout(() => setCopiedTab(null), 2000)
  }

  const handleCopy = async (text: string, tab: TabKey) => {
    // Per Fiverr's 2026 ranking guidance, ANY live-gig edit triggers a
    // 7-28 day re-evaluation. Show the warning on the first copy each
    // session (suppressible via the "don't show again" checkbox).
    if (shouldShowFiverrWarning("cooldown")) {
      setPendingCopy({ text, tab })
      return
    }
    await copyToClipboard(text, tab)
  }

  const tabs: TabKey[] = ["title", "description", "tags"]

  // Fiverr-limit metadata for each tab so the After panel can show a
  // live "57/80" pill against the actual hard cap users will paste into.
  const limitFor = (
    tab: TabKey,
    value: string,
  ): {
    length: number
    max: number
    optimalMin?: number
    optimalMax?: number
    suffix?: string
  } => {
    switch (tab) {
      case "title":
        return {
          length: value.length,
          max: FIVERR.title.max,
          optimalMin: FIVERR.title.optimalMin,
          optimalMax: FIVERR.title.optimalMax,
        }
      case "description":
        return {
          length: value.length,
          max: FIVERR.description.max,
          optimalMin: FIVERR.description.optimalMin,
          optimalMax: FIVERR.description.optimalMax,
        }
      case "tags": {
        const tagList = value
          .split(/,\s*/)
          .map((t) => t.trim())
          .filter(Boolean)
        const longest = tagList.reduce(
          (acc, t) => (t.length > acc ? t.length : acc),
          0,
        )
        return {
          length: longest,
          max: FIVERR.tag.max,
          suffix: `${tagList.length}/${FIVERR.tag.count} tags · longest tag`,
        }
      }
    }
  }

  // This panel no longer owns a scroll container — its parent page
  // scrolls vertically. We render the header + tabs + content stacked
  // at natural height; the outer page scroll keeps everything
  // reachable on any viewport.
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="size-4 text-emerald" />
          1-Click Optimization Engine
        </h3>
        <Badge variant="outline" className="border-emerald/30 text-emerald text-[10px]">
          AI Generated
        </Badge>
      </div>

      {/* Best-practice banner — always visible. Fiverr's 2026 algorithm
          attributes ranking changes to specific signal shifts, so the
          fastest way to learn what's actually moving your gig is to
          change ONE field at a time. */}
      <div className="border-b border-border bg-emerald/5 px-4 py-2.5">
        <div className="flex items-start gap-2 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0 text-emerald" />
          <p className="text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">
              Best practice:
            </span>{" "}
            apply{" "}
            <span className="font-semibold text-emerald">ONE</span> change at
            a time. Fiverr&apos;s 2026 algorithm needs 3-4 weeks of stable
            data after each edit to attribute the result — simultaneous
            changes make it impossible to tell what worked.
          </p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabKey)}
        className="flex flex-col"
      >
        <div className="border-b border-border px-4 pt-2">
          <TabsList className="h-8 w-full bg-secondary">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="flex-1 text-xs capitalize data-[state=active]:bg-card data-[state=active]:text-emerald"
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div>
          {tabs.map((key) => {
            const opt = optimizations[key]
            const beforeLimit = limitFor(key, opt.before)
            const afterLimit = limitFor(key, opt.after)
            return (
              <TabsContent key={key} value={key} className="mt-0 p-4">
                <div className="flex flex-col gap-4">
                  {/* Before */}
                  <div className="rounded-lg border border-danger/20 bg-danger/5 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex flex-1 items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-danger">
                          Before
                        </span>
                        <div className="h-px flex-1 bg-danger/10" />
                      </div>
                      <LimitChip {...beforeLimit} />
                    </div>
                    <p className="text-sm text-danger/80 leading-relaxed whitespace-pre-wrap">
                      {opt.before || "(empty)"}
                    </p>
                  </div>

                  {/* "You already applied another field this session"
                      reinforcement. Only renders on the OTHER tabs once
                      the user has copied one tab's optimized text. The
                      Copy button stays clickable — this is a nudge, not
                      a hard block — but its tone shifts from emerald to
                      amber and the explanatory copy makes the cost
                      explicit. */}
                  {appliedTab !== null && appliedTab !== key && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <p>
                        You just copied a new{" "}
                        <span className="font-semibold">{appliedTab}</span>{" "}
                        for this gig. Applying a second change today
                        re-starts Fiverr&apos;s 7-28 day evaluation window
                        and makes it impossible to tell which change is
                        actually moving your rank. Wait 3-4 weeks before
                        copying this {key} too.
                      </p>
                    </div>
                  )}

                  {/* After */}
                  <div className="rounded-lg border border-emerald/20 bg-emerald/5 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex flex-1 items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald">
                          After (Optimized by AI)
                        </span>
                        <div className="h-px flex-1 bg-emerald/10" />
                      </div>
                      <LimitChip {...afterLimit} />
                      <Button
                        size="sm"
                        variant="ghost"
                        className={
                          appliedTab !== null && appliedTab !== key
                            ? "h-7 gap-1.5 text-xs text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-400"
                            : "h-7 gap-1.5 text-xs text-emerald hover:bg-emerald/10 hover:text-emerald"
                        }
                        onClick={() => handleCopy(opt.after, key)}
                      >
                        {copiedTab === key ? (
                          <>
                            <Check className="size-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            Copy to Clipboard
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-sm text-emerald/90 leading-relaxed whitespace-pre-wrap">
                      {opt.after || "(empty)"}
                    </p>
                  </div>
                </div>
              </TabsContent>
            )
          })}
        </div>
      </Tabs>

      <FiverrWarningDialog
        variant="cooldown"
        open={pendingCopy !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCopy(null)
        }}
        onConfirm={() => {
          if (pendingCopy) {
            void copyToClipboard(pendingCopy.text, pendingCopy.tab)
            setPendingCopy(null)
          }
        }}
      />
    </div>
  )
}

// ---------- Live Fiverr-limit pill ----------

interface LimitChipProps {
  length: number
  max: number
  optimalMin?: number
  optimalMax?: number
  suffix?: string
}

function LimitChip({
  length,
  max,
  optimalMin,
  optimalMax,
  suffix,
}: LimitChipProps) {
  const tone = classifyLength({ length, max, optimalMin, optimalMax })
  return (
    <span
      title={
        optimalMin && optimalMax
          ? `Fiverr cap ${max}. Optimal range ${optimalMin}-${optimalMax}.`
          : `Fiverr cap ${max}.`
      }
      className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${chipToneClass(tone)}`}
    >
      {length}/{max}
      {suffix ? <span className="ml-1 opacity-70">· {suffix}</span> : null}
    </span>
  )
}

function chipToneClass(tone: LengthTone): string {
  switch (tone) {
    case "optimal":
      return "border-emerald/40 bg-emerald/10 text-emerald"
    case "over-optimal":
      return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    case "under":
      return "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
    case "over-max":
      return "border-danger/40 bg-danger/10 text-danger"
    case "empty":
    default:
      return "border-border bg-background/50 text-muted-foreground"
  }
}
