/**
 * Server-side helpers for the activity feed.
 *
 * Notifications are inserted by the tracker refresh path (cron + manual)
 * whenever a meaningful diff is detected between the previous and the new
 * snapshot of a gig — or between successive SERP rank checks for a tracked
 * keyword.
 *
 * Reads / updates use the user's session client (RLS-enforced).
 * Writes go through the service-role admin client.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  Notification,
  NotificationKind,
} from "@/lib/notification-types"
import type { ScrapedGig } from "@/lib/analysis-types"
import type { SerpSnapshot } from "@/lib/serp-tracking-types"
import {
  sendNotificationEmail,
  type NotificationEmailEvent,
} from "@/lib/email"

const TABLE = "notifications"

// ---------- Row helpers ----------

interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string
  payload: unknown
  created_at: string
  read_at: string | null
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

// ---------- Writes (service role) ----------

interface CreateInput {
  userId: string
  kind: NotificationKind
  title: string
  body: string
  payload?: Record<string, unknown>
}

export async function createNotification(input: CreateInput): Promise<void> {
  const admin = getSupabaseAdmin()
  if (!admin) return
  const { error } = await admin.from(TABLE).insert({
    user_id: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    payload: input.payload ?? {},
  })
  if (error) {
    console.error("[notifications] insert failed:", error.message)
    return
  }
  // Fire-and-forget email. The interface is a no-op until a provider is
  // wired up, so this stays safe in dev/local.
  await sendNotificationEmail({
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    payload: input.payload ?? {},
  } satisfies NotificationEmailEvent)
}

// ---------- Reads (RLS-enforced via the user's client) ----------

export async function listNotifications(
  client: SupabaseClient,
  options: { limit?: number } = {},
): Promise<{ items: Notification[]; unreadCount: number }> {
  const limit = options.limit ?? 30

  // Fire both reads in parallel. They're independent — RLS authorises
  // each one separately — so the response time is bounded by whichever
  // round-trip is slower, not the sum. Cuts the route's wall-clock cost
  // roughly in half (each query is a separate network hop to Supabase
  // and the bell polls this on every active tab).
  //
  // The two indexes that back these queries already exist:
  //   notifications_user_recent_idx — (user_id, created_at desc)
  //   notifications_user_unread_idx — (user_id, created_at desc)
  //                                    WHERE read_at IS NULL
  // so neither scan is the bottleneck; it's purely the network cost.
  const [listResult, countResult] = await Promise.all([
    client
      .from(TABLE)
      .select("id, kind, title, body, payload, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    client
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ])

  if (listResult.error) {
    console.error("[notifications] list failed:", listResult.error.message)
    return { items: [], unreadCount: 0 }
  }
  if (countResult.error) {
    // Non-fatal: we can still render the list, just without an accurate
    // unread badge for this tick. The next poll will recover.
    console.error(
      "[notifications] unread count failed:",
      countResult.error.message,
    )
  }

  const items = ((listResult.data ?? []) as NotificationRow[]).map(toNotification)
  return { items, unreadCount: countResult.count ?? 0 }
}

export async function markRead(
  client: SupabaseClient,
  notificationId: string,
): Promise<boolean> {
  const { error } = await client
    .from(TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("read_at", null)
  if (error) {
    console.error("[notifications] mark read failed:", error.message)
    return false
  }
  return true
}

export async function markAllRead(client: SupabaseClient): Promise<number> {
  const { data, error } = await client
    .from(TABLE)
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null)
    .select("id")
  if (error) {
    console.error("[notifications] mark all read failed:", error.message)
    return 0
  }
  return data?.length ?? 0
}

// ---------- Detection: tracker gig snapshots ----------

interface DetectGigInput {
  userId: string
  trackedGigId: string
  nickname: string | null
  prev: SnapshotLike | null
  next: SnapshotLike
}

interface SnapshotLike {
  title: string
  description: string
  thumbnailUrl: string | null
  tags: string[]
  packages: ScrapedGig["packages"]
  minPrice: number | null
  maxPrice: number | null
}

/**
 * Diff the previous vs new snapshot of a tracked gig and emit one
 * notification per meaningful change. Skipped silently when `prev` is
 * null (= this is the very first snapshot — no signal to report).
 */
export async function detectFromGigSnapshots(
  input: DetectGigInput,
): Promise<number> {
  const { userId, trackedGigId, nickname, prev, next } = input
  if (!prev) return 0

  const gigLabel = nickname?.trim() || next.title || "tracked gig"
  let emitted = 0

  // ---- Price changes (min-price = "starting price") ----
  if (
    prev.minPrice != null &&
    next.minPrice != null &&
    prev.minPrice !== next.minPrice
  ) {
    const direction = next.minPrice > prev.minPrice ? "up" : "down"
    await createNotification({
      userId,
      kind: "tracker.price_change",
      title:
        direction === "down"
          ? `Price dropped on ${gigLabel}`
          : `Price raised on ${gigLabel}`,
      body: `Starting price went from $${prev.minPrice} → $${next.minPrice}.`,
      payload: {
        trackedGigId,
        gigTitle: next.title,
        oldPrice: prev.minPrice,
        newPrice: next.minPrice,
        direction,
        field: "starting",
      },
    })
    emitted += 1
  }

  // ---- Title rewrite ----
  if (prev.title !== next.title) {
    await createNotification({
      userId,
      kind: "tracker.title_change",
      title: `Title rewritten on ${gigLabel}`,
      body: truncate(`"${prev.title}" → "${next.title}"`, 220),
      payload: {
        trackedGigId,
        gigTitle: next.title,
        oldTitle: prev.title,
        newTitle: next.title,
      },
    })
    emitted += 1
  }

  // ---- Thumbnail change ----
  if ((prev.thumbnailUrl ?? "") !== (next.thumbnailUrl ?? "")) {
    await createNotification({
      userId,
      kind: "tracker.thumbnail_change",
      title: `Thumbnail changed on ${gigLabel}`,
      body: "The seller swapped their gig image.",
      payload: { trackedGigId, gigTitle: next.title },
    })
    emitted += 1
  }

  // ---- Tag set updated ----
  if (!setEq(prev.tags, next.tags)) {
    await createNotification({
      userId,
      kind: "tracker.tags_change",
      title: `Tags updated on ${gigLabel}`,
      body: `${prev.tags.join(", ")} → ${next.tags.join(", ")}`,
      payload: {
        trackedGigId,
        gigTitle: next.title,
        oldTags: prev.tags,
        newTags: next.tags,
      },
    })
    emitted += 1
  }

  // ---- Description / packages — single rollup each to avoid noise ----
  if (prev.description !== next.description) {
    await createNotification({
      userId,
      kind: "tracker.description_change",
      title: `Description edited on ${gigLabel}`,
      body: "The seller updated their gig description.",
      payload: { trackedGigId, gigTitle: next.title },
    })
    emitted += 1
  }
  if (!packagesEq(prev.packages, next.packages)) {
    await createNotification({
      userId,
      kind: "tracker.packages_change",
      title: `Packages changed on ${gigLabel}`,
      body: "Pricing or package details were tweaked.",
      payload: { trackedGigId, gigTitle: next.title },
    })
    emitted += 1
  }

  return emitted
}

// ---------- Detection: SERP rank snapshots ----------

interface DetectRankInput {
  userId: string
  trackedGigId: string
  trackedKeywordId: string
  keyword: string
  nickname: string | null
  gigTitle: string | null
  prev: SerpSnapshot | null
  next: SerpSnapshot
}

export async function detectFromSerpSnapshots(
  input: DetectRankInput,
): Promise<number> {
  const { userId, trackedGigId, trackedKeywordId, keyword, prev, next } = input
  const gigLabel = input.nickname?.trim() || input.gigTitle || "your gig"

  const prevPos = prev?.position ?? null
  const newPos = next.position ?? null

  if (prev == null) {
    // First check — only report if they ranked.
    if (newPos != null) {
      await createNotification({
        userId,
        kind: "rank.appeared",
        title: `New rank for "${keyword}"`,
        body: `${gigLabel} ranked #${newPos} for "${keyword}" on first check.`,
        payload: {
          trackedGigId,
          trackedKeywordId,
          keyword,
          gigTitle: input.gigTitle,
          newPosition: newPos,
        },
      })
      return 1
    }
    return 0
  }

  // Lost a previously-held rank.
  if (prevPos != null && newPos == null) {
    await createNotification({
      userId,
      kind: "rank.lost",
      title: `Lost rank for "${keyword}"`,
      body: `${gigLabel} fell out of the top results (was #${prevPos}).`,
      payload: {
        trackedGigId,
        trackedKeywordId,
        keyword,
        gigTitle: input.gigTitle,
        oldPosition: prevPos,
      },
    })
    return 1
  }

  // Gained a rank we didn't have last time.
  if (prevPos == null && newPos != null) {
    await createNotification({
      userId,
      kind: "rank.appeared",
      title: `Ranked for "${keyword}"`,
      body: `${gigLabel} entered the SERP at #${newPos}.`,
      payload: {
        trackedGigId,
        trackedKeywordId,
        keyword,
        gigTitle: input.gigTitle,
        newPosition: newPos,
      },
    })
    return 1
  }

  // Position moved.
  if (prevPos != null && newPos != null && prevPos !== newPos) {
    const direction = newPos < prevPos ? "up" : "down"
    await createNotification({
      userId,
      kind: direction === "up" ? "rank.up" : "rank.down",
      title:
        direction === "up"
          ? `Rank improved for "${keyword}"`
          : `Rank dropped for "${keyword}"`,
      body:
        direction === "up"
          ? `${gigLabel} moved #${prevPos} → #${newPos}.`
          : `${gigLabel} slipped from #${prevPos} → #${newPos}.`,
      payload: {
        trackedGigId,
        trackedKeywordId,
        keyword,
        gigTitle: input.gigTitle,
        oldPosition: prevPos,
        newPosition: newPos,
      },
    })
    return 1
  }

  return 0
}

// ---------- Internals ----------

function setEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const A = new Set(a)
  for (const x of b) if (!A.has(x)) return false
  return true
}

function packagesEq(
  a: ScrapedGig["packages"],
  b: ScrapedGig["packages"],
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].price !== b[i].price ||
      a[i].details !== b[i].details
    ) {
      return false
    }
  }
  return true
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}
