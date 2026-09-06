/**
 * Server-side helpers for SERP rank tracking.
 *
 * Operates on:
 *   - tracked_keywords          (one row per gig × keyword)
 *   - serp_snapshots            (time-series of rank checks)
 *
 * The actual Fiverr SERP scrape lives in `lib/scraper.ts#scrapeFiverrSearch`.
 * We hit it with a stealth proxy, then match the user's gig URL against
 * the returned listings to extract the rank. We compare URLs by their
 * Fiverr "seller/gig" path (last two segments) because Fiverr SPA URLs
 * can carry tracking params or use the share-short form.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { scrapeFiverrSearch, type ScrapedSearchGig } from "@/lib/scraper"
import type {
  SerpCompetitor,
  SerpSnapshot,
  TrackedKeyword,
  TrackedKeywordWithLatest,
} from "@/lib/serp-tracking-types"
import { detectFromSerpSnapshots } from "@/lib/notifications"

const KW_TABLE = "tracked_keywords"
const SNAP_TABLE = "serp_snapshots"

// ---------- URL identity helpers ----------

/**
 * Reduce a Fiverr gig URL to a stable identifier for matching across
 * search results. Returns `<seller>/<gig-slug>` lowercased — strips
 * scheme, host, tracking params, locale prefix, and trailing junk.
 */
export function gigPathKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    // Drop locale prefix if any (e.g. /en/, /es/) so /en/seller/gig
    // matches /seller/gig.
    const segs = u.pathname.split("/").filter(Boolean)
    const localePrefixes = new Set([
      "en", "es", "fr", "de", "it", "nl", "pt", "ru", "tr", "id",
    ])
    if (segs.length > 0 && localePrefixes.has(segs[0])) segs.shift()
    if (segs.length < 2) return u.pathname.toLowerCase()
    // Take the last two segments — typically "<seller>/<gig-slug>".
    return `${segs[segs.length - 2]}/${segs[segs.length - 1]}`.toLowerCase()
  } catch {
    return rawUrl.toLowerCase().split("?")[0]
  }
}

/** Build the Fiverr search URL we'll scrape for a given keyword. */
export function buildSearchUrl(keyword: string): string {
  const q = encodeURIComponent(keyword.trim().replace(/\s+/g, "+"))
  return `https://www.fiverr.com/search/gigs?query=${q}`
}

// ---------- Mapping ----------

interface TrackedKeywordRow {
  id: string
  tracked_gig_id: string
  keyword: string
  search_url: string
  created_at: string
}

interface SerpSnapshotRow {
  id: string
  tracked_keyword_id: string
  checked_at: string
  position: number | null
  not_found: boolean
  results_scanned: number
  competitors: unknown
}

function toKeyword(row: TrackedKeywordRow): TrackedKeyword {
  return {
    id: row.id,
    trackedGigId: row.tracked_gig_id,
    keyword: row.keyword,
    searchUrl: row.search_url,
    createdAt: row.created_at,
  }
}

function toSnapshot(row: SerpSnapshotRow): SerpSnapshot {
  const comps = Array.isArray(row.competitors)
    ? (row.competitors as SerpCompetitor[])
    : []
  return {
    id: row.id,
    trackedKeywordId: row.tracked_keyword_id,
    checkedAt: row.checked_at,
    position: row.position,
    notFound: row.not_found,
    resultsScanned: row.results_scanned,
    competitors: comps,
  }
}

// ---------- Core: run one SERP check ----------

/**
 * Scrape the SERP for `searchUrl`, locate `gigUrl` in the listings, and
 * persist a snapshot. Returns the inserted snapshot, or null on infra
 * failure. Throws if the upstream scrape itself fails so the caller can
 * surface it.
 */
export async function runSerpCheck(
  trackedKeywordId: string,
  gigUrl: string,
  searchUrl: string,
): Promise<SerpSnapshot | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null

  const scraped: ScrapedSearchGig[] = await scrapeFiverrSearch(searchUrl)
  const targetKey = gigPathKey(gigUrl)

  let position: number | null = null
  let competitors: SerpCompetitor[] = []
  for (const g of scraped) {
    if (gigPathKey(g.url) === targetKey) {
      position = g.position
      break
    }
  }

  if (position != null) {
    // Top 5 competitors ranked ABOVE the user.
    competitors = scraped
      .filter((g) => g.position < position!)
      .slice(-5)
      .map((g) => ({
        url: g.url,
        title: g.title,
        position: g.position,
        price: g.price,
      }))
  } else {
    // Not found: show top 5 overall so the user sees who they're up against.
    competitors = scraped.slice(0, 5).map((g) => ({
      url: g.url,
      title: g.title,
      position: g.position,
      price: g.price,
    }))
  }

  const { data, error } = await admin
    .from(SNAP_TABLE)
    .insert({
      tracked_keyword_id: trackedKeywordId,
      position,
      not_found: position == null,
      results_scanned: scraped.length,
      competitors,
    })
    .select(
      "id, tracked_keyword_id, checked_at, position, not_found, results_scanned, competitors",
    )
    .single()
  if (error || !data) {
    console.error(
      "[serp] insert snapshot failed:",
      error?.message ?? "unknown",
    )
    return null
  }
  return toSnapshot(data as SerpSnapshotRow)
}

// ---------- CRUD ----------

/**
 * Add a keyword to track for an already-tracked gig. Idempotent on
 * (tracked_gig_id, keyword) — the unique index handles dedup. Always
 * tries to capture an initial snapshot, but a scrape failure doesn't
 * roll back the row (we return a `warning` instead).
 */
export async function addKeyword(
  userId: string,
  trackedGigId: string,
  rawKeyword: string,
): Promise<
  | {
      ok: true
      keyword: TrackedKeyword
      snapshot: SerpSnapshot | null
      warning?: string
    }
  | { ok: false; error: string; status: number }
> {
  const admin = getSupabaseAdmin()
  if (!admin) {
    return { ok: false, error: "Supabase admin unavailable", status: 500 }
  }

  // Ownership check: the gig must belong to the user.
  const { data: gig } = await admin
    .from("tracked_gigs")
    .select("id, user_id, url")
    .eq("id", trackedGigId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!gig) {
    return { ok: false, error: "Tracked gig not found", status: 404 }
  }

  const keyword = rawKeyword.trim().replace(/\s+/g, " ")
  if (keyword.length < 2 || keyword.length > 80) {
    return {
      ok: false,
      error: "Keyword must be between 2 and 80 characters",
      status: 400,
    }
  }
  const searchUrl = buildSearchUrl(keyword)

  // Idempotent insert.
  const { data: existing } = await admin
    .from(KW_TABLE)
    .select("id, tracked_gig_id, keyword, search_url, created_at")
    .eq("tracked_gig_id", trackedGigId)
    .eq("keyword", keyword)
    .maybeSingle()

  let row: TrackedKeywordRow
  if (existing) {
    row = existing
  } else {
    const { data: inserted, error } = await admin
      .from(KW_TABLE)
      .insert({
        tracked_gig_id: trackedGigId,
        keyword,
        search_url: searchUrl,
      })
      .select("id, tracked_gig_id, keyword, search_url, created_at")
      .single()
    if (error || !inserted) {
      return {
        ok: false,
        error: error?.message ?? "Failed to add keyword",
        status: 500,
      }
    }
    row = inserted
  }

  // Initial check — best-effort.
  let snapshot: SerpSnapshot | null = null
  let warning: string | undefined
  try {
    snapshot = await runSerpCheck(row.id, gig.url as string, searchUrl)
  } catch (err) {
    warning =
      err instanceof Error
        ? `Initial rank check failed: ${err.message}`
        : "Initial rank check failed"
  }

  return { ok: true, keyword: toKeyword(row), snapshot, warning }
}

export async function removeKeyword(
  userId: string,
  trackedKeywordId: string,
): Promise<boolean> {
  const admin = getSupabaseAdmin()
  if (!admin) return false

  // Verify ownership through the parent gig before deleting.
  const { data: row } = await admin
    .from(KW_TABLE)
    .select(
      "id, tracked_gig_id, tracked_gigs!inner(user_id)",
    )
    .eq("id", trackedKeywordId)
    .maybeSingle()
  if (!row) return false
  // The Supabase typing here yields `tracked_gigs: { user_id: string } | null`
  // depending on the version — narrow defensively.
  const owner = Array.isArray(
    (row as unknown as { tracked_gigs: unknown }).tracked_gigs,
  )
    ? (
        (row as unknown as { tracked_gigs: { user_id: string }[] })
          .tracked_gigs[0]?.user_id
      )
    : (
        (row as unknown as { tracked_gigs: { user_id: string } | null })
          .tracked_gigs?.user_id
      )
  if (owner !== userId) return false

  const { error } = await admin
    .from(KW_TABLE)
    .delete()
    .eq("id", trackedKeywordId)
  if (error) {
    console.error("[serp] delete keyword failed:", error.message)
    return false
  }
  return true
}

// ---------- Reads ----------

export async function listKeywords(
  userId: string,
  trackedGigId: string,
): Promise<TrackedKeywordWithLatest[]> {
  const admin = getSupabaseAdmin()
  if (!admin) return []

  const { data: gig } = await admin
    .from("tracked_gigs")
    .select("id")
    .eq("id", trackedGigId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!gig) return []

  const { data: kws } = await admin
    .from(KW_TABLE)
    .select("id, tracked_gig_id, keyword, search_url, created_at")
    .eq("tracked_gig_id", trackedGigId)
    .order("created_at", { ascending: true })
  if (!kws || kws.length === 0) return []

  const kwIds = kws.map((k) => k.id as string)
  // Pull every snapshot in one round-trip — we need the latest + the one
  // before it (for the delta arrow).
  const { data: snaps } = await admin
    .from(SNAP_TABLE)
    .select(
      "id, tracked_keyword_id, checked_at, position, not_found, results_scanned, competitors",
    )
    .in("tracked_keyword_id", kwIds)
    .order("checked_at", { ascending: false })

  const byKw = new Map<string, SerpSnapshotRow[]>()
  for (const s of (snaps ?? []) as SerpSnapshotRow[]) {
    const arr = byKw.get(s.tracked_keyword_id) ?? []
    arr.push(s)
    byKw.set(s.tracked_keyword_id, arr)
  }

  return (kws as TrackedKeywordRow[]).map((kw) => {
    const rows = byKw.get(kw.id) ?? []
    const latest = rows[0] ? toSnapshot(rows[0]) : null
    const previousPosition = rows[1]?.position ?? null
    return {
      keyword: toKeyword(kw),
      latest,
      previousPosition,
    }
  })
}

export async function getKeyword(
  userId: string,
  trackedKeywordId: string,
): Promise<{ keyword: TrackedKeyword; gigUrl: string } | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null
  const { data } = await admin
    .from(KW_TABLE)
    .select(
      "id, tracked_gig_id, keyword, search_url, created_at, tracked_gigs!inner(user_id, url)",
    )
    .eq("id", trackedKeywordId)
    .maybeSingle()
  if (!data) return null
  // Narrow the embedded join (see removeKeyword for the same dance).
  const tg = (data as unknown as {
    tracked_gigs: { user_id: string; url: string } | { user_id: string; url: string }[] | null
  }).tracked_gigs
  const parent = Array.isArray(tg) ? tg[0] : tg
  if (!parent || parent.user_id !== userId) return null
  return {
    keyword: toKeyword(data as TrackedKeywordRow),
    gigUrl: parent.url,
  }
}

export async function listSnapshots(
  trackedKeywordId: string,
  limit = 90,
): Promise<SerpSnapshot[]> {
  const admin = getSupabaseAdmin()
  if (!admin) return []
  const { data } = await admin
    .from(SNAP_TABLE)
    .select(
      "id, tracked_keyword_id, checked_at, position, not_found, results_scanned, competitors",
    )
    .eq("tracked_keyword_id", trackedKeywordId)
    .order("checked_at", { ascending: true })
    .limit(limit)
  return ((data ?? []) as SerpSnapshotRow[]).map(toSnapshot)
}

// ---------- Refresh ----------

/**
 * Re-check a single keyword's rank. Used by the per-keyword refresh API
 * and the cron job. Also emits an activity-feed notification when the
 * rank meaningfully changed (gained/lost/moved).
 */
export async function refreshKeyword(
  trackedKeywordId: string,
): Promise<{ ok: true; snapshot: SerpSnapshot } | { ok: false; error: string }> {
  const admin = getSupabaseAdmin()
  if (!admin) return { ok: false, error: "Supabase admin unavailable" }

  const { data } = await admin
    .from(KW_TABLE)
    .select(
      "id, keyword, search_url, tracked_gig_id, tracked_gigs!inner(user_id, url, nickname)",
    )
    .eq("id", trackedKeywordId)
    .maybeSingle()
  if (!data) return { ok: false, error: "Keyword not found" }
  const tg = (data as unknown as {
    tracked_gigs:
      | { user_id: string; url: string; nickname: string | null }
      | { user_id: string; url: string; nickname: string | null }[]
      | null
  }).tracked_gigs
  const parent = Array.isArray(tg) ? tg[0] : tg
  if (!parent) return { ok: false, error: "Parent gig missing" }

  // Pull the most recent snapshot so we can diff after the check.
  let prevSnap: SerpSnapshot | null = null
  {
    const { data: prev } = await admin
      .from(SNAP_TABLE)
      .select(
        "id, tracked_keyword_id, checked_at, position, not_found, results_scanned, competitors",
      )
      .eq("tracked_keyword_id", trackedKeywordId)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (prev) prevSnap = toSnapshot(prev as SerpSnapshotRow)
  }

  try {
    const snap = await runSerpCheck(
      trackedKeywordId,
      parent.url,
      data.search_url as string,
    )
    if (!snap) return { ok: false, error: "Failed to persist snapshot" }

    // Best-effort notification — failures here must not roll back the check.
    try {
      await detectFromSerpSnapshots({
        userId: parent.user_id,
        trackedGigId: data.tracked_gig_id as string,
        trackedKeywordId,
        keyword: data.keyword as string,
        nickname: parent.nickname,
        gigTitle: null,
        prev: prevSnap,
        next: snap,
      })
    } catch (err) {
      console.error(
        "[serp] notification emit failed:",
        err instanceof Error ? err.message : err,
      )
    }

    return { ok: true, snapshot: snap }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Refresh every SERP keyword that hasn't been re-checked within
 * `minIntervalMs`. Mirrors `refreshDueGigs` in `lib/tracking.ts`.
 */
export async function refreshDueKeywords(options: {
  minIntervalMs?: number
  limit?: number
}): Promise<{ trackedKeywordId: string; ok: boolean; error?: string }[]> {
  const admin = getSupabaseAdmin()
  if (!admin) return []

  const minIntervalMs = options.minIntervalMs ?? 12 * 3600_000 // 12h default
  const limit = options.limit ?? 100

  const { data: kws } = await admin
    .from(KW_TABLE)
    .select("id")
    .limit(limit)
  if (!kws || kws.length === 0) return []
  const ids = kws.map((k) => k.id as string)

  const { data: latest } = await admin
    .from(SNAP_TABLE)
    .select("tracked_keyword_id, checked_at")
    .in("tracked_keyword_id", ids)
    .order("checked_at", { ascending: false })

  const latestBy = new Map<string, string>()
  for (const r of latest ?? []) {
    const k = r.tracked_keyword_id as string
    if (!latestBy.has(k)) latestBy.set(k, r.checked_at as string)
  }
  const now = Date.now()
  const due = ids.filter((id) => {
    const last = latestBy.get(id)
    if (!last) return true
    return now - new Date(last).getTime() >= minIntervalMs
  })

  const results: { trackedKeywordId: string; ok: boolean; error?: string }[] = []
  for (const id of due) {
    const r = await refreshKeyword(id)
    results.push({
      trackedKeywordId: id,
      ok: r.ok,
      error: "error" in r ? r.error : undefined,
    })
  }
  return results
}
