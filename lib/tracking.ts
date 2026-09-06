/**
 * Server-side helpers for the Tracker feature.
 *
 * Operates on the `tracked_gigs` and `tracked_gig_snapshots` tables. All
 * mutations go through the service-role admin client and explicitly filter
 * by `user_id` so the API layer is responsible for enforcing ownership.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { normalizeUrl } from "@/lib/cache"
import { scrapeFiverrGig } from "@/lib/scraper"
import type { ScrapedGig } from "@/lib/analysis-types"
import type {
  RefreshResult,
  SnapshotChange,
  SnapshotChangeEntry,
  TrackedGig,
  TrackedGigSnapshot,
  TrackedGigWithLatest,
} from "@/lib/tracking-types"
import { detectFromGigSnapshots } from "@/lib/notifications"
import {
  AGENCY_TRACKED_GIG_LIMIT,
  PRO_TRACKED_GIG_LIMIT,
  getTrackedGigQuota,
} from "@/lib/quota"

const TRACKED = "tracked_gigs"
const SNAPSHOTS = "tracked_gig_snapshots"

// ---------- Mapping helpers ----------

interface TrackedGigRow {
  id: string
  user_id: string
  url: string
  nickname: string | null
  created_at: string
}

interface SnapshotRow {
  id: string
  tracked_gig_id: string
  scraped_at: string
  title: string
  description: string
  thumbnail_url: string | null
  tags: unknown
  packages: unknown
  min_price: number | null
  max_price: number | null
  search_keyword: string | null
  search_position: number | null
}

function toTrackedGig(row: TrackedGigRow): TrackedGig {
  return {
    id: row.id,
    url: row.url,
    nickname: row.nickname,
    createdAt: row.created_at,
  }
}

function toSnapshot(row: SnapshotRow): TrackedGigSnapshot {
  return {
    id: row.id,
    trackedGigId: row.tracked_gig_id,
    scrapedAt: row.scraped_at,
    title: row.title,
    description: row.description,
    thumbnailUrl: row.thumbnail_url,
    tags: (row.tags as string[]) ?? [],
    packages: (row.packages as ScrapedGig["packages"]) ?? [],
    minPrice: row.min_price,
    maxPrice: row.max_price,
    searchKeyword: row.search_keyword,
    searchPosition: row.search_position,
  }
}

function priceRange(packages: ScrapedGig["packages"]): {
  min: number | null
  max: number | null
} {
  const prices = packages
    .map((p) => p.price)
    .filter((p): p is number => typeof p === "number" && p > 0)
  if (prices.length === 0) return { min: null, max: null }
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

// ---------- CRUD ----------

export async function listTracked(
  userId: string,
): Promise<TrackedGigWithLatest[]> {
  const admin = getSupabaseAdmin()
  if (!admin) return []

  const { data: gigs, error } = await admin
    .from(TRACKED)
    .select("id, user_id, url, nickname, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (error || !gigs) {
    if (error) console.error("[tracking] list failed:", error.message)
    return []
  }
  if (gigs.length === 0) return []

  // Pull the latest snapshot per tracked gig in one round trip.
  const ids = gigs.map((g) => g.id)
  const { data: snaps } = await admin
    .from(SNAPSHOTS)
    .select(
      "id, tracked_gig_id, scraped_at, title, description, thumbnail_url, tags, packages, min_price, max_price, search_keyword, search_position",
    )
    .in("tracked_gig_id", ids)
    .order("scraped_at", { ascending: false })

  const latestByGig = new Map<string, SnapshotRow>()
  for (const s of (snaps ?? []) as SnapshotRow[]) {
    if (!latestByGig.has(s.tracked_gig_id)) latestByGig.set(s.tracked_gig_id, s)
  }

  return gigs.map((g) => ({
    gig: toTrackedGig(g),
    latest: latestByGig.has(g.id) ? toSnapshot(latestByGig.get(g.id)!) : null,
  }))
}

export async function getTracked(
  userId: string,
  id: string,
): Promise<TrackedGig | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null
  const { data, error } = await admin
    .from(TRACKED)
    .select("id, user_id, url, nickname, created_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  return toTrackedGig(data)
}

export async function listSnapshots(
  trackedGigId: string,
  limit = 90,
): Promise<TrackedGigSnapshot[]> {
  const admin = getSupabaseAdmin()
  if (!admin) return []
  const { data, error } = await admin
    .from(SNAPSHOTS)
    .select(
      "id, tracked_gig_id, scraped_at, title, description, thumbnail_url, tags, packages, min_price, max_price, search_keyword, search_position",
    )
    .eq("tracked_gig_id", trackedGigId)
    .order("scraped_at", { ascending: true })
    .limit(limit)
  if (error || !data) {
    if (error) console.error("[tracking] snapshots failed:", error.message)
    return []
  }
  return (data as SnapshotRow[]).map(toSnapshot)
}

/** Add a tracked gig and capture an initial snapshot. */
export async function addTracked(
  userId: string,
  rawUrl: string,
  nickname?: string,
): Promise<
  | { ok: true; gig: TrackedGig; snapshot: TrackedGigSnapshot }
  | { ok: false; error: string; status: number }
> {
  const admin = getSupabaseAdmin()
  if (!admin) {
    return { ok: false, error: "Supabase admin unavailable", status: 500 }
  }
  const url = normalizeUrl(rawUrl)

  // Check existing (idempotent on duplicate).
  const { data: existing } = await admin
    .from(TRACKED)
    .select("id, user_id, url, nickname, created_at")
    .eq("user_id", userId)
    .eq("url", url)
    .maybeSingle()

  let row: TrackedGigRow
  if (existing) {
    row = existing
  } else {
    // Enforce the tracked-gig cap before persisting a NEW row. Re-adding an
    // existing URL is idempotent and doesn't count against the quota.
    const quota = await getTrackedGigQuota(userId)
    if (!quota.allowed) {
      const reason = quota.isPremium
        ? `You're tracking ${quota.used}/${quota.limit} gigs. Remove one to add another, or upgrade to Agency for ${AGENCY_TRACKED_GIG_LIMIT}.`
        : `Free plan is limited to ${quota.limit} tracked gig. Upgrade to Pro to track up to ${PRO_TRACKED_GIG_LIMIT} competitors.`
      return { ok: false, error: reason, status: 402 }
    }

    const { data: inserted, error: insertErr } = await admin
      .from(TRACKED)
      .insert({ user_id: userId, url, nickname: nickname?.trim() || null })
      .select("id, user_id, url, nickname, created_at")
      .single()
    if (insertErr || !inserted) {
      return {
        ok: false,
        error: insertErr?.message ?? "Failed to add gig",
        status: 500,
      }
    }
    row = inserted
  }

  // Initial scrape.
  let scraped: ScrapedGig
  try {
    scraped = await scrapeFiverrGig(url)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Initial scrape failed",
      status: 502,
    }
  }

  const snapshot = await insertSnapshot(row.id, scraped)
  if (!snapshot) {
    return { ok: false, error: "Failed to store snapshot", status: 500 }
  }
  return { ok: true, gig: toTrackedGig(row), snapshot }
}

export async function removeTracked(
  userId: string,
  id: string,
): Promise<boolean> {
  const admin = getSupabaseAdmin()
  if (!admin) return false
  const { error } = await admin
    .from(TRACKED)
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
  if (error) {
    console.error("[tracking] delete failed:", error.message)
    return false
  }
  return true
}

// ---------- Snapshot ops ----------

async function insertSnapshot(
  trackedGigId: string,
  scraped: ScrapedGig,
): Promise<TrackedGigSnapshot | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null
  const { min, max } = priceRange(scraped.packages)
  const { data, error } = await admin
    .from(SNAPSHOTS)
    .insert({
      tracked_gig_id: trackedGigId,
      title: scraped.title,
      description: scraped.description,
      thumbnail_url: scraped.thumbnailUrl,
      tags: scraped.tags,
      packages: scraped.packages,
      min_price: min,
      max_price: max,
    })
    .select(
      "id, tracked_gig_id, scraped_at, title, description, thumbnail_url, tags, packages, min_price, max_price, search_keyword, search_position",
    )
    .single()
  if (error || !data) {
    if (error) console.error("[tracking] insert snapshot failed:", error.message)
    return null
  }
  return toSnapshot(data as SnapshotRow)
}

/**
 * Re-scrape a tracked gig and store a new snapshot. Returns a tagged result
 * the API layer can aggregate across many tracked gigs.
 *
 * If `owner` is provided we also detect a snapshot diff vs the previous
 * row and emit user-visible notifications (price drop, title rewrite,
 * etc.). Skipping `owner` keeps callers from spamming notifications when
 * they don't have a user context yet (e.g. legacy callers).
 */
export async function refreshOne(
  trackedGigId: string,
  url: string,
  owner?: { userId: string; nickname: string | null },
): Promise<RefreshResult> {
  try {
    const admin = getSupabaseAdmin()
    // Capture the previous snapshot BEFORE we insert the new one — used
    // for change detection downstream.
    let prevSnap: TrackedGigSnapshot | null = null
    if (admin && owner) {
      const { data } = await admin
        .from(SNAPSHOTS)
        .select(
          "id, tracked_gig_id, scraped_at, title, description, thumbnail_url, tags, packages, min_price, max_price, search_keyword, search_position",
        )
        .eq("tracked_gig_id", trackedGigId)
        .order("scraped_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) prevSnap = toSnapshot(data as SnapshotRow)
    }

    const scraped = await scrapeFiverrGig(url)
    const snap = await insertSnapshot(trackedGigId, scraped)
    if (!snap) {
      return {
        trackedGigId,
        ok: false,
        error: "Failed to persist snapshot",
      }
    }

    if (owner) {
      // Best-effort — notification failures must not roll back the snapshot.
      try {
        await detectFromGigSnapshots({
          userId: owner.userId,
          trackedGigId,
          nickname: owner.nickname,
          prev: prevSnap,
          next: snap,
        })
      } catch (err) {
        console.error(
          "[tracking] notification emit failed:",
          err instanceof Error ? err.message : err,
        )
      }
    }

    return { trackedGigId, ok: true, scrapedAt: snap.scrapedAt }
  } catch (err) {
    return {
      trackedGigId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Refresh every tracked gig that hasn't been re-scraped within `minIntervalMs`.
 * Pass `userId` to scope to one user; omit to refresh all users (cron mode).
 */
export async function refreshDueGigs(options: {
  userId?: string
  minIntervalMs?: number
  /** Hard cap on how many gigs to refresh in one invocation. */
  limit?: number
}): Promise<RefreshResult[]> {
  const admin = getSupabaseAdmin()
  if (!admin) return []

  const minIntervalMs = options.minIntervalMs ?? 6 * 3600_000
  const limit = options.limit ?? 50

  // Pull candidate gigs.
  let query = admin
    .from(TRACKED)
    .select("id, user_id, url, nickname, created_at")
  if (options.userId) query = query.eq("user_id", options.userId)
  query = query.limit(limit)
  const { data: gigs, error } = await query
  if (error || !gigs) return []

  // Pull latest scrape time per gig.
  const ids = gigs.map((g) => g.id)
  const { data: snaps } = await admin
    .from(SNAPSHOTS)
    .select("tracked_gig_id, scraped_at")
    .in("tracked_gig_id", ids)
    .order("scraped_at", { ascending: false })

  const latestByGig = new Map<string, string>()
  for (const s of snaps ?? []) {
    const sid = s.tracked_gig_id as string
    if (!latestByGig.has(sid)) latestByGig.set(sid, s.scraped_at as string)
  }
  const now = Date.now()
  const due = gigs.filter((g) => {
    const last = latestByGig.get(g.id)
    if (!last) return true
    return now - new Date(last).getTime() >= minIntervalMs
  })

  // Sequential to avoid hammering Firecrawl. 50 gigs × ~5s = 4 min worst case.
  const results: RefreshResult[] = []
  for (const g of due) {
    results.push(
      await refreshOne(g.id, g.url, {
        userId: g.user_id,
        nickname: g.nickname ?? null,
      }),
    )
  }
  return results
}

// ---------- Diff / change-log ----------

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

/** Diff two consecutive snapshots into a human-readable change list. */
export function diffSnapshots(
  prev: TrackedGigSnapshot,
  next: TrackedGigSnapshot,
): SnapshotChange[] {
  const changes: SnapshotChange[] = []
  if (prev.title !== next.title) {
    changes.push({ kind: "title", description: "Title was rewritten" })
  }
  if (prev.description !== next.description) {
    changes.push({
      kind: "description",
      description: "Description was edited",
    })
  }
  if ((prev.thumbnailUrl ?? "") !== (next.thumbnailUrl ?? "")) {
    changes.push({ kind: "thumbnail", description: "Thumbnail changed" })
  }
  if (!setEq(prev.tags, next.tags)) {
    changes.push({ kind: "tags", description: "Search tags updated" })
  }
  if (!packagesEq(prev.packages, next.packages)) {
    changes.push({
      kind: "packages",
      description: "Package details changed",
    })
  }
  if (prev.minPrice !== next.minPrice && next.minPrice != null && prev.minPrice != null) {
    const delta = next.minPrice - prev.minPrice
    changes.push({
      kind: "price-min",
      description: `Starting price ${delta > 0 ? "raised" : "dropped"} from $${prev.minPrice} → $${next.minPrice}`,
      delta,
    })
  }
  if (prev.maxPrice !== next.maxPrice && next.maxPrice != null && prev.maxPrice != null) {
    const delta = next.maxPrice - prev.maxPrice
    changes.push({
      kind: "price-max",
      description: `Top tier price ${delta > 0 ? "raised" : "dropped"} from $${prev.maxPrice} → $${next.maxPrice}`,
      delta,
    })
  }
  return changes
}

/** Build a chronological change log from a sorted snapshot list. */
export function buildChangeLog(
  snapshots: TrackedGigSnapshot[],
): SnapshotChangeEntry[] {
  const out: SnapshotChangeEntry[] = []
  for (let i = 1; i < snapshots.length; i++) {
    const changes = diffSnapshots(snapshots[i - 1], snapshots[i])
    if (changes.length > 0) {
      out.push({ at: snapshots[i].scrapedAt, changes })
    }
  }
  // Newest first.
  return out.reverse()
}
