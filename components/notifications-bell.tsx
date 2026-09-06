"use client"

/**
 * In-app activity bell — surfaces tracker changes ("price dropped on
 * competitor gig X", "rank moved #3 → #1 for cursor", etc.) generated
 * by the cron + manual refresh paths.
 *
 * Lives in both the desktop sidebar and the mobile topbar (Tailwind
 * hides one or the other with `md:hidden` / `hidden md:block`, but
 * BOTH stay mounted in the DOM at every breakpoint). To avoid the
 * obvious double-poll trap, fetch state + the polling timer live in a
 * module-level singleton (`notificationsStore` below): every bell
 * subscribes to the same snapshot, one shared interval drives all
 * background refetches, and the two badges can never drift out of
 * sync. The poller pauses while the tab is hidden (no point burning
 * battery on a backgrounded dashboard) and refires once on
 * `visibilitychange → visible` so the badge catches up immediately.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bell,
  CheckCheck,
  CircleDashed,
  Loader2,
  Pencil,
  Tag,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"

import type {
  Notification,
  NotificationKind,
  NotificationListResponse,
} from "@/lib/notification-types"

interface Props {
  /**
   * Optional callback — fires when the user clicks a tracker-* notification
   * so the parent can deep-link them to the relevant tracker detail view.
   */
  onOpenTrackedGig?: (trackedGigId: string) => void
  /** Override polling interval (ms). Default 60s. */
  pollMs?: number
  /** Tailwind tint for the trigger button. */
  className?: string
}

// ---------- Shared store (one per browser tab) ----------
//
// We deliberately do NOT put fetch state inside the component, because
// the bell is mounted twice in the dashboard tree (mobile topbar +
// desktop floating slot) and per-component state would mean two
// pollers, two debounce timers, and two badge counts that can drift
// apart. A tiny module-level singleton solves all three.

interface NotificationsSnapshot {
  items: Notification[]
  unread: number
  loading: boolean
  error: string | null
}

const initialSnapshot: NotificationsSnapshot = {
  items: [],
  unread: 0,
  loading: false,
  error: null,
}

const notificationsStore = (() => {
  let snapshot: NotificationsSnapshot = initialSnapshot
  const subscribers = new Set<() => void>()

  let inflight: Promise<void> | null = null
  let lastFetchAt = 0
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollMs = 60_000
  let activeCount = 0
  let visibilityBound = false

  function emit() {
    snapshot = { ...snapshot }
    for (const fn of subscribers) fn()
  }

  function patch(p: Partial<NotificationsSnapshot>) {
    snapshot = { ...snapshot, ...p }
    for (const fn of subscribers) fn()
  }

  function isHidden() {
    return typeof document !== "undefined" && document.visibilityState === "hidden"
  }

  async function fetchOnce(opts: { force?: boolean } = {}) {
    if (inflight) return inflight
    if (isHidden() && !opts.force) return
    const now = Date.now()
    // Soft-debounce: never less than 5s apart unless `force`.
    if (!opts.force && now - lastFetchAt < 5_000) return
    lastFetchAt = now

    patch({ loading: true, error: null })
    inflight = (async () => {
      try {
        const res = await fetch("/api/notifications", { credentials: "include" })
        if (!res.ok) throw new Error(`${res.status}`)
        const data = (await res.json()) as NotificationListResponse
        patch({
          items: data.items,
          unread: data.unreadCount,
          loading: false,
          error: null,
        })
      } catch (err) {
        patch({
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load",
        })
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  function bindVisibility() {
    if (visibilityBound || typeof document === "undefined") return
    visibilityBound = true
    document.addEventListener("visibilitychange", () => {
      if (!isHidden() && activeCount > 0) {
        // Catch up immediately on focus, then resume the regular cadence.
        void fetchOnce({ force: true })
      }
    })
  }

  function subscribe(listener: () => void, intervalMs: number) {
    subscribers.add(listener)
    activeCount += 1
    // Smallest non-default interval wins — most consumers will accept
    // the default 60s but a caller can opt into faster polling for a
    // specific surface.
    pollMs = Math.min(pollMs, intervalMs)
    bindVisibility()

    if (activeCount === 1) {
      void fetchOnce({ force: true })
      pollTimer = setInterval(() => {
        if (!isHidden()) void fetchOnce()
      }, pollMs)
    }

    return () => {
      subscribers.delete(listener)
      activeCount = Math.max(0, activeCount - 1)
      if (activeCount === 0 && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
        pollMs = 60_000
      }
    }
  }

  return {
    subscribe,
    getSnapshot: () => snapshot,
    fetchOnce,
    setSnapshot: patch,
    emit,
  }
})()

function useNotificationsStore(intervalMs: number): NotificationsSnapshot {
  const [snap, setSnap] = useState<NotificationsSnapshot>(() =>
    notificationsStore.getSnapshot(),
  )
  useEffect(() => {
    const unsubscribe = notificationsStore.subscribe(() => {
      setSnap(notificationsStore.getSnapshot())
    }, intervalMs)
    return unsubscribe
  }, [intervalMs])
  return snap
}

export function NotificationsBell({
  onOpenTrackedGig,
  pollMs = 60_000,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const { items, unread, loading, error } = useNotificationsStore(pollMs)

  // Refresh on open so the badge can't go stale right when the user looks.
  useEffect(() => {
    if (open) void notificationsStore.fetchOnce({ force: true })
  }, [open])

  const markAllRead = useCallback(async () => {
    // Optimistic — flip unread to 0, then commit on the server.
    const prevSnapshot = notificationsStore.getSnapshot()
    notificationsStore.setSnapshot({
      unread: 0,
      items: prevSnapshot.items.map((n) => ({
        ...n,
        readAt: n.readAt ?? new Date().toISOString(),
      })),
    })
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        credentials: "include",
      })
    } catch {
      notificationsStore.setSnapshot({
        items: prevSnapshot.items,
        unread: prevSnapshot.items.filter((n) => !n.readAt).length,
      })
    }
  }, [])

  const markOneRead = useCallback(async (id: string) => {
    const current = notificationsStore.getSnapshot()
    const target = current.items.find((n) => n.id === id)
    if (!target || target.readAt) return
    const nowIso = new Date().toISOString()
    notificationsStore.setSnapshot({
      items: current.items.map((n) =>
        n.id === id ? { ...n, readAt: nowIso } : n,
      ),
      unread: Math.max(0, current.unread - 1),
    })
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        credentials: "include",
      })
    } catch {
      // No rollback — single-row read is forgivable to drop.
    }
  }, [])

  const handleClick = useCallback(
    (n: Notification) => {
      void markOneRead(n.id)
      const gigId = typeof n.payload.trackedGigId === "string"
        ? (n.payload.trackedGigId as string)
        : null
      if (gigId && onOpenTrackedGig) {
        setOpen(false)
        onOpenTrackedGig(gigId)
      }
    },
    [markOneRead, onOpenTrackedGig],
  )

  const badge = useMemo(() => {
    if (unread <= 0) return null
    return (
      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald px-1 text-[9px] font-semibold text-primary-foreground">
        {unread > 9 ? "9+" : unread}
      </span>
    )
  }, [unread])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative size-9 text-muted-foreground hover:text-foreground ${className ?? ""}`}
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        >
          <Bell className="size-4" />
          {badge}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[20rem] p-0 sm:w-96"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-emerald" />
            <span className="text-sm font-semibold text-foreground">
              Activity
            </span>
            {unread > 0 && (
              <span className="rounded-full bg-emerald/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald">
                {unread} new
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={markAllRead}
            disabled={unread === 0}
          >
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
        </div>

        <ScrollArea className="max-h-[60vh] sm:max-h-96">
          {loading && items.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading activity...
            </div>
          )}
          {error && items.length === 0 && (
            <div className="flex items-start gap-2 px-3 py-4 text-xs text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>Could not load notifications.</span>
            </div>
          )}
          {!loading && items.length === 0 && !error && (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
              <CircleDashed className="size-6 text-muted-foreground/60" />
              <div>
                <div className="font-medium text-foreground">No activity yet</div>
                <div className="mt-0.5">
                  Track a gig or add a keyword and you&apos;ll see changes here.
                </div>
              </div>
            </div>
          )}
          <ul className="divide-y divide-border">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/60 ${
                    n.readAt ? "" : "bg-emerald/[0.04]"
                  }`}
                >
                  <div className="mt-0.5">{iconFor(n.kind)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {n.title}
                      </span>
                      {!n.readAt && (
                        <span className="size-1.5 shrink-0 rounded-full bg-emerald" />
                      )}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                      {n.body}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {relativeTime(n.createdAt)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

// ---------- Per-kind icon ----------

function iconFor(kind: NotificationKind) {
  switch (kind) {
    case "tracker.price_change":
      return <TrendingDown className="size-3.5 text-emerald" />
    case "tracker.title_change":
    case "tracker.description_change":
      return <Pencil className="size-3.5 text-warning" />
    case "tracker.tags_change":
      return <Tag className="size-3.5 text-violet-400" />
    case "tracker.thumbnail_change":
    case "tracker.packages_change":
      return <Pencil className="size-3.5 text-muted-foreground" />
    case "rank.up":
      return <ArrowUp className="size-3.5 text-emerald" />
    case "rank.down":
      return <ArrowDown className="size-3.5 text-danger" />
    case "rank.appeared":
      return <TrendingUp className="size-3.5 text-emerald" />
    case "rank.lost":
      return <TrendingDown className="size-3.5 text-danger" />
    default:
      return <Bell className="size-3.5 text-muted-foreground" />
  }
}

// ---------- Relative time ----------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  // Locale pinned to "en-US" with explicit options so the rendered string
  // is identical on SSR and after hydration (Node defaults to en-US, the
  // browser uses the viewer locale → text mismatch → React hydration
  // error). Explicit options also avoid the unfriendly "5/31/2026"
  // default and match the format the other date helpers use.
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}
