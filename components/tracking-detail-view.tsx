"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  AlertCircle,
  RefreshCw,
  Activity,
  History,
  Tag,
  Package,
  Image as ImageIcon,
  FileText,
  ArrowUp,
  ArrowDown,
  Type,
} from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RankTrackerCard } from "@/components/rank-tracker-card"

import type {
  ChangeKind,
  SnapshotChangeEntry,
  TrackedGig,
  TrackedGigSnapshot,
  TrackingHistoryResponse,
} from "@/lib/tracking-types"

interface TrackingDetailViewProps {
  trackedGigId: string
  onBack: () => void
}

export function TrackingDetailView({
  trackedGigId,
  onBack,
}: TrackingDetailViewProps) {
  const [data, setData] = useState<TrackingHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tracking/${trackedGigId}/history`)
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          json?.error ?? `Request failed with status ${res.status}`,
        )
      }
      const json = (await res.json()) as TrackingHistoryResponse
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }, [trackedGigId])

  useEffect(() => {
    load()
  }, [load])

  const handleRefresh = async () => {
    setError(null)
    setRefreshing(true)
    try {
      // Refresh refreshes ALL of the user's tracked gigs; it's the simplest
      // way to ensure consistent behavior with the list view.
      const res = await fetch("/api/tracking/refresh", { method: "POST" })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          json?.error ?? `Request failed with status ${res.status}`,
        )
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed")
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        {/* Top bar */}
        <div className="mb-5 flex items-center justify-between gap-3 sm:mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to tracker
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-1.5"
          >
            {refreshing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>

        {loading && !data && (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading history...
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {data && (
          <DetailBody
            gig={data.gig}
            snapshots={data.snapshots}
            changes={data.changes}
          />
        )}
      </div>
    </ScrollArea>
  )
}

// ---------- Body ----------

function DetailBody({
  gig,
  snapshots,
  changes,
}: {
  gig: TrackedGig
  snapshots: TrackedGigSnapshot[]
  changes: SnapshotChangeEntry[]
}) {
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold text-foreground">
                {gig.nickname || latest?.title || gig.url}
              </h2>
              {gig.nickname && latest?.title && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {latest.title}
                </p>
              )}
              <a
                href={gig.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <span className="truncate">{gig.url}</span>
                <ExternalLink className="size-3" />
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-border text-[10px] text-muted-foreground"
              >
                {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"}
              </Badge>
              {latest && (
                <Badge
                  variant="outline"
                  className="border-emerald/30 text-[10px] text-emerald"
                >
                  Latest {formatDate(latest.scrapedAt)}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <PriceTimeline snapshots={snapshots} />

      <RankTrackerCard trackedGigId={gig.id} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChangeLogCard changes={changes} />
        <CurrentSnapshotCard snapshot={latest} />
      </div>
    </div>
  )
}

// ---------- Price timeline ----------

function PriceTimeline({ snapshots }: { snapshots: TrackedGigSnapshot[] }) {
  const series = useMemo(
    () =>
      snapshots
        .filter((s) => s.minPrice != null || s.maxPrice != null)
        .map((s) => ({
          t: new Date(s.scrapedAt).getTime(),
          dateLabel: formatDateShort(s.scrapedAt),
          minPrice: s.minPrice,
          maxPrice: s.maxPrice,
        })),
    [snapshots],
  )

  if (series.length < 2) {
    return (
      <Card className="border-border bg-card py-0">
        <CardHeader className="px-4 pb-3 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4 text-emerald" />
            Price over time
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-6 pt-2 text-xs text-muted-foreground">
          Charts unlock once we&apos;ve captured at least two snapshots. Hit
          <span className="mx-1 font-medium text-foreground">Refresh</span>
          again later or wait for the next scheduled scrape.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-emerald" />
          Price over time
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="h-[220px] w-full">
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
                dataKey="dateLabel"
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                      <div className="font-semibold text-foreground">
                        {label}
                      </div>
                      {payload.map((p) => (
                        <div
                          key={String(p.dataKey)}
                          className="text-muted-foreground"
                        >
                          {String(p.name)}:{" "}
                          <span className="font-medium text-foreground">
                            ${p.value as number}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
              />
              <Line
                type="monotone"
                dataKey="minPrice"
                name="Starting price"
                stroke="var(--emerald)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--emerald)" }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="maxPrice"
                name="Top tier"
                stroke="var(--muted-foreground)"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- Change log ----------

const KIND_META: Record<
  ChangeKind,
  { icon: typeof Type; tone: "emerald" | "warning" | "danger" | "neutral" }
> = {
  title: { icon: Type, tone: "warning" },
  description: { icon: FileText, tone: "warning" },
  thumbnail: { icon: ImageIcon, tone: "warning" },
  tags: { icon: Tag, tone: "warning" },
  packages: { icon: Package, tone: "warning" },
  "price-min": { icon: ArrowUp, tone: "emerald" },
  "price-max": { icon: ArrowDown, tone: "emerald" },
}

function ChangeLogCard({ changes }: { changes: SnapshotChangeEntry[] }) {
  return (
    <Card className="border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-emerald" />
          Change log
          <Badge
            variant="outline"
            className="ml-auto border-border text-[10px] text-muted-foreground"
          >
            {changes.length} event{changes.length === 1 ? "" : "s"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {changes.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            Nothing has changed between snapshots yet. Once the gig is edited
            (or competitor pivots), we&apos;ll surface it here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {changes.map((entry, i) => (
              <li key={i} className="px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {formatDate(entry.at)}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {entry.changes.map((c, j) => {
                    const meta = KIND_META[c.kind]
                    const Icon = meta.icon
                    const toneText =
                      meta.tone === "emerald"
                        ? "text-emerald"
                        : meta.tone === "warning"
                          ? "text-warning"
                          : meta.tone === "danger"
                            ? "text-danger"
                            : "text-foreground"
                    return (
                      <li
                        key={j}
                        className="flex items-start gap-2 text-xs text-foreground/90"
                      >
                        <Icon
                          className={`mt-0.5 size-3.5 shrink-0 ${toneText}`}
                        />
                        <span>{c.description}</span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Current snapshot summary ----------

function CurrentSnapshotCard({
  snapshot,
}: {
  snapshot: TrackedGigSnapshot | null
}) {
  if (!snapshot) {
    return (
      <Card className="border-border bg-card py-0">
        <CardHeader className="px-4 pb-3 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Tag className="size-4 text-emerald" />
            Current snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 text-xs text-muted-foreground">
          No snapshot captured yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Tag className="size-4 text-emerald" />
          Current snapshot
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Title
          </div>
          <p className="mt-0.5 text-sm text-foreground">{snapshot.title}</p>
        </div>

        {snapshot.tags.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tags
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {snapshot.tags.map((t, i) => (
                <Badge
                  key={`${t}-${i}`}
                  variant="outline"
                  className="border-border text-[10px] text-muted-foreground"
                >
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {snapshot.packages.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Packages
            </div>
            <ul className="mt-1 space-y-1">
              {snapshot.packages.map((p, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between text-xs text-foreground/90"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="font-semibold text-emerald">${p.price}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Formatting ----------

// Locale is pinned to "en-US" so server and client always render the same
// string. Without it, Node's SSR pass defaults to en-US ("May 30, 2026")
// while the browser uses the viewer's locale (e.g. en-GB → "30 May 2026"),
// and the text-node mismatch trips a React hydration error. This view is
// dashboard-client-only today, but pinning makes it safe if it's ever
// pulled into a server-rendered path.
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
