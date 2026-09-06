"use client"

/**
 * Niche keyword discovery card embedded in TrendsView.
 *
 * Fetches GET /api/trends/[slug]/keywords for the active niche, renders
 * the candidates sorted by opportunity tier, and lets the user jump
 * straight to the Gig Generator pre-filled with the chosen phrase.
 */

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Compass,
  Loader2,
  Sparkles,
  TrendingUp,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type {
  KeywordCandidate,
  OpportunityTier,
} from "@/lib/keyword-discovery"

interface KeywordDiscoveryResponse {
  niche: string
  slug: string
  scrapedAt: string
  sampleSize: number
  topSize: number
  candidates: Array<
    KeywordCandidate & {
      intent?: "transactional" | "informational" | "branded" | "tool" | null
      difficulty?: "low" | "medium" | "high" | null
      rationale?: string | null
    }
  >
}

interface KeywordDiscoveryCardProps {
  slug: string
  /** Bumps when the snapshot changes; forces a refetch. */
  snapshotKey: string | null
  onUseKeyword?: (phrase: string) => void
}

export function KeywordDiscoveryCard({
  slug,
  snapshotKey,
  onUseKeyword,
}: KeywordDiscoveryCardProps) {
  const [data, setData] = useState<KeywordDiscoveryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/trends/${slug}/keywords`)
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(json?.error ?? `Request failed (${res.status})`)
      }
      const json = (await res.json()) as KeywordDiscoveryResponse
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed")
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void load()
  }, [load, snapshotKey])

  return (
    <Card className="mb-6 border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Compass className="size-4 text-emerald" />
          Untapped keywords
          <Badge
            variant="outline"
            className="ml-2 border-emerald/30 text-[10px] text-emerald"
          >
            New
          </Badge>
          {data && (
            <Badge
              variant="outline"
              className="ml-auto border-border text-[10px] text-muted-foreground"
            >
              {data.candidates.length} found
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading && !data && (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Mining keywords from the latest niche scrape...
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {data && data.candidates.length === 0 && (
          <p className="py-3 text-xs text-muted-foreground">
            No keyword opportunities surfaced for this niche yet. Try
            refreshing the trends snapshot above.
          </p>
        )}

        {data && data.candidates.length > 0 && (
          <>
            <p className="mb-3 text-[11px] text-muted-foreground">
              Phrases used across the {data.sampleSize}-gig sample but
              under-used by the top {data.topSize}. Bigger gap = bigger
              ranking opportunity.
            </p>
            <ul className="space-y-2">
              {data.candidates.slice(0, 12).map((c) => (
                <KeywordRow
                  key={c.phrase}
                  candidate={c}
                  onUse={() => onUseKeyword?.(c.phrase)}
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Row ----------

function KeywordRow({
  candidate,
  onUse,
}: {
  candidate: KeywordDiscoveryResponse["candidates"][number]
  onUse: () => void
}) {
  const tierMeta = TIER_META[candidate.tier]
  return (
    <li className="rounded-md border border-border/70 bg-card/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          {candidate.phrase}
        </span>
        <Badge
          variant="outline"
          className={`text-[10px] ${tierMeta.cls}`}
        >
          {tierMeta.label}
        </Badge>
        {candidate.intent && (
          <Badge
            variant="outline"
            className="border-border text-[10px] text-muted-foreground"
          >
            {candidate.intent}
          </Badge>
        )}
        {candidate.difficulty && (
          <Badge
            variant="outline"
            className={`text-[10px] ${DIFF_META[candidate.difficulty].cls}`}
          >
            <Brain className="mr-1 size-2.5" />
            {DIFF_META[candidate.difficulty].label}
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 text-[11px] text-emerald hover:bg-emerald/10"
          onClick={onUse}
        >
          Generate gig
          <ArrowRight className="size-3" />
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Sparkles className="size-3" />
          Full sample: {candidate.fullPct.toFixed(1)}% ({candidate.fullCount})
        </span>
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="size-3" />
          Top {Math.max(1, Math.round(candidate.topPct === 0 ? 10 : 10))}:{" "}
          {candidate.topPct.toFixed(1)}%
        </span>
      </div>
      {candidate.rationale && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {candidate.rationale}
        </p>
      )}
    </li>
  )
}

// ---------- Visual tone tables ----------

const TIER_META: Record<
  OpportunityTier,
  { label: string; cls: string }
> = {
  high: {
    label: "High opportunity",
    cls: "border-emerald/30 bg-emerald/10 text-emerald",
  },
  medium: {
    label: "Medium",
    cls: "border-warning/30 bg-warning/10 text-warning",
  },
  low: {
    label: "Low",
    cls: "border-border text-muted-foreground",
  },
  saturated: {
    label: "Saturated",
    cls: "border-danger/30 bg-danger/10 text-danger",
  },
}

const DIFF_META: Record<
  "low" | "medium" | "high",
  { label: string; cls: string }
> = {
  low: {
    label: "Low difficulty",
    cls: "border-emerald/30 bg-emerald/10 text-emerald",
  },
  medium: {
    label: "Medium difficulty",
    cls: "border-warning/30 bg-warning/10 text-warning",
  },
  high: {
    label: "High difficulty",
    cls: "border-danger/30 bg-danger/10 text-danger",
  },
}
