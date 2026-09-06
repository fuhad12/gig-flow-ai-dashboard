"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Clock,
  Loader2,
  AlertCircle,
  ChevronRight,
  Search,
  Target,
  Sparkles,
  RefreshCw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

import type { AnalyzeResponse } from "@/lib/analysis-types"
import type { HistoryItem } from "@/app/api/history/route"

interface HistoryViewProps {
  onOpenItem: (item: AnalyzeResponse) => void
  onAnalyze: () => void
}

export function HistoryView({ onOpenItem, onAnalyze }: HistoryViewProps) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/history")
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      const data = (await res.json()) as { items: HistoryItem[] }
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <ScrollArea className="h-full">
      <div className="p-4 sm:p-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2 sm:text-xl">
              <Clock className="size-5 text-emerald" />
              My Gigs
            </h2>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Every analysis you&apos;ve run, most recent first
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={load}
              disabled={loading}
              className="gap-1.5"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={onAnalyze}
              className="gap-1.5 bg-emerald text-primary-foreground hover:bg-emerald/90"
            >
              <Search className="size-3.5" />
              New analysis
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">Could not load history</div>
              <div className="text-xs text-danger/80">{error}</div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && items.length === 0 && (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading your analyses...
          </div>
        )}

        {/* Empty */}
        {!loading && !error && items.length === 0 && (
          <Card className="border-dashed border-border bg-card/40">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-emerald/10">
                <Sparkles className="size-5 text-emerald" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  No analyses yet
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Paste a Fiverr gig URL on the Analyze page to get started.
                </div>
              </div>
              <Button
                size="sm"
                onClick={onAnalyze}
                className="mt-1 bg-emerald text-primary-foreground hover:bg-emerald/90"
              >
                <Search className="mr-1.5 size-3.5" />
                Analyze a gig
              </Button>
            </CardContent>
          </Card>
        )}

        {/* List */}
        {items.length > 0 && (
          <Card className="border-border bg-card py-0">
            <CardContent className="px-0 pb-0 pt-0">
              <ul className="flex flex-col divide-y divide-border">
                {items.map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    onOpen={() => onOpenItem(item)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {items.length >= 50 && (
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Showing your 50 most recent analyses
          </p>
        )}
      </div>
    </ScrollArea>
  )
}

function HistoryRow({
  item,
  onOpen,
}: {
  item: HistoryItem
  onOpen: () => void
}) {
  const score = Math.round(item.analysis.optimizationScore)
  const ranking = item.analysis.rankingPotential
  const when = item.cachedAt ? formatRelative(item.cachedAt) : ""

  const scoreColor =
    score >= 80
      ? "text-emerald"
      : score >= 50
        ? "text-warning"
        : "text-danger"

  const rankingTone =
    ranking === "High"
      ? "border-emerald/30 bg-emerald/10 text-emerald"
      : ranking === "Medium"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-danger/30 bg-danger/10 text-danger"

  const displayUrl = item.url.replace(/^https?:\/\//, "")

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-secondary/40 focus:outline-none focus:bg-secondary/60"
      >
        {/* Score */}
        <div className="flex shrink-0 flex-col items-center">
          <div className={`text-2xl font-bold leading-none ${scoreColor}`}>
            {score}
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
            score
          </div>
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-sm font-medium text-foreground">
            {item.scraped.title}
          </div>
          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {displayUrl}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge
              variant="outline"
              className={`h-5 px-2 py-0 text-[10px] font-semibold uppercase tracking-wide ${rankingTone}`}
            >
              <Target className="mr-1 size-3" />
              {ranking} ranking
            </Badge>
            <span className="text-[11px] text-muted-foreground">{when}</span>
          </div>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
