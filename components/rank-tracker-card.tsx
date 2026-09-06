"use client"

/**
 * Search-rank tracker card embedded in the TrackingDetailView.
 *
 * For a given tracked gig it lets the user:
 *   - Add new keywords to monitor
 *   - See the current rank for each keyword (with ▲/▼ vs last check)
 *   - Drill in to view the per-keyword rank history chart + top competitors
 *   - Manually re-run a rank check
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

import type {
  KeywordHistoryResponse,
  ListKeywordsResponse,
  SerpSnapshot,
  TrackedKeyword,
  TrackedKeywordWithLatest,
} from "@/lib/serp-tracking-types"

interface RankTrackerCardProps {
  trackedGigId: string
}

export function RankTrackerCard({ trackedGigId }: RankTrackerCardProps) {
  const [items, setItems] = useState<TrackedKeywordWithLatest[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newKeyword, setNewKeyword] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tracking/${trackedGigId}/keywords`)
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(json?.error ?? `Request failed (${res.status})`)
      }
      const json = (await res.json()) as ListKeywordsResponse
      setItems(json.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }, [trackedGigId])

  useEffect(() => {
    void load()
  }, [load])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    const kw = newKeyword.trim()
    if (kw.length < 2) {
      setError("Enter a keyword (at least 2 characters)")
      return
    }
    setAdding(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/tracking/${trackedGigId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(json?.error ?? `Request failed (${res.status})`)
      }
      const json = (await res.json()) as {
        keyword: TrackedKeyword
        snapshot: SerpSnapshot | null
        warning?: string
      }
      if (json.warning) setNotice(json.warning)
      setNewKeyword("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add keyword")
    } finally {
      setAdding(false)
    }
  }

  const handleRefreshOne = async (kid: string) => {
    setBusy((prev) => ({ ...prev, [kid]: true }))
    setError(null)
    try {
      const res = await fetch(
        `/api/tracking/keywords/${kid}/refresh`,
        { method: "POST" },
      )
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(json?.error ?? `Request failed (${res.status})`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed")
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[kid]
        return next
      })
    }
  }

  const handleDelete = async (kid: string) => {
    if (!confirm("Stop tracking this keyword?")) return
    setBusy((prev) => ({ ...prev, [kid]: true }))
    try {
      const res = await fetch(`/api/tracking/keywords/${kid}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(json?.error ?? `Request failed (${res.status})`)
      }
      if (expandedId === kid) setExpandedId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[kid]
        return next
      })
    }
  }

  return (
    <Card className="border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Search className="size-4 text-emerald" />
          Search rank tracker
          <Badge
            variant="outline"
            className="ml-auto border-border text-[10px] text-muted-foreground"
          >
            {items.length} keyword{items.length === 1 ? "" : "s"}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 px-4 pb-4">
        {/* Add form */}
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            placeholder="e.g. minimalist logo designer"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            disabled={adding}
            maxLength={80}
            className="h-9 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={adding || !newKeyword.trim()}
            className="gap-1.5 bg-emerald text-primary-foreground hover:bg-emerald/90"
          >
            {adding ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Track
          </Button>
        </form>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {loading && items.length === 0 && (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading keywords...
          </div>
        )}

        {!loading && items.length === 0 && (
          <p className="py-4 text-xs text-muted-foreground">
            No keywords tracked yet. Add a Fiverr search term above and
            we&apos;ll check this gig&apos;s ranking on a schedule.
          </p>
        )}

        {items.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {items.map((item) => (
              <KeywordRow
                key={item.keyword.id}
                item={item}
                expanded={expandedId === item.keyword.id}
                onToggleExpand={() =>
                  setExpandedId(
                    expandedId === item.keyword.id ? null : item.keyword.id,
                  )
                }
                onRefresh={() => handleRefreshOne(item.keyword.id)}
                onDelete={() => handleDelete(item.keyword.id)}
                busy={!!busy[item.keyword.id]}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- One row ----------

function KeywordRow({
  item,
  expanded,
  onToggleExpand,
  onRefresh,
  onDelete,
  busy,
}: {
  item: TrackedKeywordWithLatest
  expanded: boolean
  onToggleExpand: () => void
  onRefresh: () => void
  onDelete: () => void
  busy: boolean
}) {
  const { keyword, latest, previousPosition } = item

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleExpand}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium text-foreground">
            {keyword.keyword}
          </span>
        </button>
        <PositionBadge snapshot={latest} previous={previousPosition} />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onRefresh}
          disabled={busy}
          title="Re-check rank"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-danger"
          onClick={onDelete}
          disabled={busy}
          title="Stop tracking"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {latest && (
        <div className="mt-1 pl-5 text-[10px] text-muted-foreground">
          Checked {formatDate(latest.checkedAt)} · scanned{" "}
          {latest.resultsScanned} results
        </div>
      )}
      {expanded && <KeywordDetail keywordId={keyword.id} />}
    </li>
  )
}

// ---------- Position badge with trend arrow ----------

function PositionBadge({
  snapshot,
  previous,
}: {
  snapshot: SerpSnapshot | null
  previous: number | null
}) {
  if (!snapshot) {
    return (
      <Badge
        variant="outline"
        className="border-border text-[10px] text-muted-foreground"
      >
        Pending
      </Badge>
    )
  }
  if (snapshot.notFound || snapshot.position == null) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-danger/30 bg-danger/10 text-[10px] text-danger"
      >
        <XCircle className="size-3" />
        Not in top {snapshot.resultsScanned || 20}
      </Badge>
    )
  }
  // Lower position = better (rank 1 is best). Delta < 0 means improved.
  const delta = previous != null ? snapshot.position - previous : null
  const tone =
    snapshot.position <= 5
      ? "emerald"
      : snapshot.position <= 15
        ? "warning"
        : "danger"
  const toneCls =
    tone === "emerald"
      ? "border-emerald/30 bg-emerald/10 text-emerald"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-danger/30 bg-danger/10 text-danger"
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] font-semibold ${toneCls}`}
    >
      #{snapshot.position}
      {delta != null && delta !== 0 && (
        <span className="flex items-center gap-0.5 text-[9px] opacity-80">
          {delta < 0 ? (
            <ArrowUp className="size-2.5" />
          ) : (
            <ArrowDown className="size-2.5" />
          )}
          {Math.abs(delta)}
        </span>
      )}
      {delta === 0 && <Minus className="size-2.5 opacity-60" />}
    </Badge>
  )
}

// ---------- Detail (history + competitors) ----------

function KeywordDetail({ keywordId }: { keywordId: string }) {
  const [data, setData] = useState<KeywordHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/tracking/keywords/${keywordId}`)
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as
            | { error?: string }
            | null
          throw new Error(json?.error ?? `Request failed (${res.status})`)
        }
        const json = (await res.json()) as KeywordHistoryResponse
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Load failed")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [keywordId])

  if (loading) {
    return (
      <div className="ml-5 mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Loading history...
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="ml-5 mt-2 text-xs text-danger">
        {error ?? "No data"}
      </div>
    )
  }

  const latest = data.snapshots[data.snapshots.length - 1] ?? null
  return (
    <div className="ml-5 mt-2 space-y-3">
      <RankTimeline snapshots={data.snapshots} />
      {latest && latest.competitors.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Activity className="size-3" />
            {latest.notFound ? "Top 5 in this SERP" : "Above you in SERP"}
          </div>
          <ul className="space-y-1">
            {latest.competitors.map((c) => (
              <li
                key={`${c.url}-${c.position}`}
                className="flex items-center gap-2 rounded border border-border/60 bg-card/50 px-2 py-1.5 text-xs"
              >
                <Badge
                  variant="outline"
                  className="shrink-0 border-border text-[10px] text-muted-foreground"
                >
                  #{c.position}
                </Badge>
                <span className="flex-1 truncate text-foreground/90">
                  {c.title}
                </span>
                {c.price != null && (
                  <span className="shrink-0 font-semibold text-emerald">
                    ${c.price}
                  </span>
                )}
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------- Rank timeline chart ----------

function RankTimeline({ snapshots }: { snapshots: SerpSnapshot[] }) {
  const series = useMemo(
    () =>
      snapshots.map((s) => ({
        t: new Date(s.checkedAt).getTime(),
        label: formatDateShort(s.checkedAt),
        // Plot null when not found so the line gaps gracefully.
        position: s.notFound || s.position == null ? null : s.position,
      })),
    [snapshots],
  )

  if (series.filter((p) => p.position != null).length < 2) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Charts appear once we have at least two rank checks. Hit refresh
        again later, or wait for the scheduled scrape.
      </p>
    )
  }

  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={series}
          margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
          />
          <YAxis
            // Inverted so rank 1 sits at the TOP of the chart.
            reversed
            domain={[1, "dataMax + 2"]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            tickFormatter={(v) => `#${v}`}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const v = payload[0]?.value as number | null
              return (
                <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <div className="font-semibold text-foreground">{label}</div>
                  <div className="text-muted-foreground">
                    Rank:{" "}
                    <span className="font-medium text-foreground">
                      {v == null ? "not in top N" : `#${v}`}
                    </span>
                  </div>
                </div>
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="position"
            stroke="var(--emerald)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--emerald)" }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------- Formatting ----------

// Locale is pinned to "en-US" so server and client always render the same
// string. Without it, Node's SSR pass defaults to en-US ("May 30") while
// the browser uses the viewer's locale (e.g. en-GB → "30 May"), and the
// text-node mismatch trips a React hydration error. This card is rendered
// client-only today, but pinning is cheap insurance against future SSR.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}
