"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import {
  Radar,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  ExternalLink,
  ChevronRight,
  ImageOff,
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
  RefreshResponse,
  TrackedGigWithLatest,
  TrackingListResponse,
} from "@/lib/tracking-types"

interface TrackingViewProps {
  /** Called when the user picks a tracked gig to inspect in detail. */
  onOpenGig: (id: string) => void
}

export function TrackingView({ onOpenGig }: TrackingViewProps) {
  const [items, setItems] = useState<TrackedGigWithLatest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [url, setUrl] = useState("")
  const [nickname, setNickname] = useState("")
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/tracking")
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      const data = (await res.json()) as TrackingListResponse
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

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    setNotice(null)
    setError(null)
    if (!url.trim().match(/^https?:\/\//)) {
      setError("Paste a full URL starting with https://")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          nickname: nickname.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      setUrl("")
      setNickname("")
      setNotice("Gig added — initial snapshot captured.")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add gig")
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Stop tracking this gig? Snapshot history will be deleted.")) {
      return
    }
    try {
      const res = await fetch(`/api/tracking/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      setItems((prev) => prev.filter((it) => it.gig.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete gig")
    }
  }

  const handleRefreshAll = async () => {
    setNotice(null)
    setError(null)
    setRefreshing(true)
    try {
      const res = await fetch("/api/tracking/refresh", { method: "POST" })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      const data = (await res.json()) as RefreshResponse
      const ok = data.refreshed
      const fail = data.failed
      setNotice(
        fail === 0
          ? `Refreshed ${ok} gig${ok === 1 ? "" : "s"}.`
          : `Refreshed ${ok}, ${fail} failed.`,
      )
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
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
              <Radar className="size-5 text-emerald sm:size-6" />
              Tracker
            </h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Watch competitor gigs (or your own) and see exactly what changed
              over time.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefreshAll}
            disabled={refreshing || items.length === 0}
            className="gap-1.5"
          >
            {refreshing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh all
          </Button>
        </div>

        {/* Add form */}
        <Card className="mb-6 border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Track a new gig</CardTitle>
            <CardDescription>
              Paste any Fiverr gig URL. We&apos;ll grab a baseline snapshot now
              and auto-refresh on a 6-hour cycle (when cron is wired).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleAdd}
              className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto]"
            >
              <div className="space-y-1.5">
                <Label htmlFor="track-url" className="sr-only">
                  Gig URL
                </Label>
                <Input
                  id="track-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://www.fiverr.com/username/gig-slug"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={adding}
                  className="bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="track-nickname" className="sr-only">
                  Nickname
                </Label>
                <Input
                  id="track-nickname"
                  placeholder="Nickname (optional)"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  disabled={adding}
                  maxLength={80}
                  className="bg-background"
                />
              </div>
              <Button
                type="submit"
                disabled={adding}
                className="gap-1.5 bg-emerald text-primary-foreground hover:bg-emerald/90"
              >
                {adding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {adding ? "Adding..." : "Track"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {notice && (
          <div className="mb-4 rounded-md border border-emerald/30 bg-emerald/10 p-3 text-xs text-emerald">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && items.length === 0 && (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading tracked gigs...
          </div>
        )}

        {!loading && items.length === 0 && (
          <Card className="border-dashed border-border bg-card">
            <CardContent className="py-12 text-center">
              <Radar className="mx-auto mb-3 size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">
                No tracked gigs yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a gig above to start collecting snapshots.
              </p>
            </CardContent>
          </Card>
        )}

        {items.length > 0 && (
          <Card className="border-border bg-card py-0">
            <CardContent className="px-0 pb-0 pt-0">
              <ul className="flex flex-col divide-y divide-border">
                {items.map((it) => (
                  <TrackedRow
                    key={it.gig.id}
                    item={it}
                    onOpen={() => onOpenGig(it.gig.id)}
                    onDelete={() => handleDelete(it.gig.id)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  )
}

function TrackedRow({
  item,
  onOpen,
  onDelete,
}: {
  item: TrackedGigWithLatest
  onOpen: () => void
  onDelete: () => void
}) {
  const { gig, latest } = item
  const [imageError, setImageError] = useState(false)

  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30">
      <button
        onClick={onOpen}
        className="flex flex-1 items-center gap-3 text-left"
      >
        {/* Thumbnail */}
        <div className="flex-shrink-0">
          {latest?.thumbnailUrl && !imageError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={latest.thumbnailUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="h-14 w-24 rounded border border-border object-cover"
            />
          ) : (
            <div className="flex h-14 w-24 items-center justify-center rounded border border-border bg-muted/40">
              <ImageOff className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {gig.nickname || latest?.title || gig.url}
            </span>
            <a
              href={gig.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3" />
            </a>
          </div>
          {gig.nickname && latest?.title && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {latest.title}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {latest?.minPrice != null && (
              <Badge
                variant="outline"
                className="border-emerald/30 text-[10px] text-emerald"
              >
                ${latest.minPrice}
                {latest.maxPrice != null && latest.maxPrice !== latest.minPrice
                  ? `–$${latest.maxPrice}`
                  : ""}
              </Badge>
            )}
            <span>
              {latest?.tags.length
                ? `${latest.tags.length} tag${latest.tags.length === 1 ? "" : "s"}`
                : "no tags"}
            </span>
            <span>
              {latest
                ? `Updated ${formatRelative(latest.scrapedAt)}`
                : "no snapshot yet"}
            </span>
          </div>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        className="size-8 text-muted-foreground hover:text-danger"
        title="Stop tracking"
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  )
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}
