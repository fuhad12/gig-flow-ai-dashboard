import { getSupabaseAdmin } from "@/lib/supabase/admin"
import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"

const TABLE = "gig_analyses"
const DEFAULT_TTL_HOURS = 24

export interface CachedAnalysis {
  scraped: ScrapedGig
  analysis: GigAnalysis
  cachedAt: string
}

/**
 * Normalize a Fiverr URL so trivial variants collide on the same cache entry.
 * - Trim whitespace and trailing slashes
 * - Lowercase the scheme + host (paths stay case-sensitive)
 * - Strip well-known tracking params
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "")
  try {
    const u = new URL(trimmed)
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase()
    const drop = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
      "context_referrer",
    ])
    for (const key of [...u.searchParams.keys()]) {
      if (drop.has(key.toLowerCase())) u.searchParams.delete(key)
    }
    u.hash = ""
    return u.toString().replace(/\/+$/, "")
  } catch {
    return trimmed.toLowerCase()
  }
}

/**
 * Return the freshest cached analysis for `url` if one exists within the TTL.
 * Silent on infra errors — caching is best-effort and must never break the
 * primary request flow.
 */
export async function getCachedAnalysis(
  url: string,
  ttlHours: number = DEFAULT_TTL_HOURS,
): Promise<CachedAnalysis | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return null

  const cutoff = new Date(Date.now() - ttlHours * 3600_000).toISOString()
  const normalized = normalizeUrl(url)

  const { data, error } = await supabase
    .from(TABLE)
    .select("scraped, analysis, created_at")
    .eq("url", normalized)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[cache] lookup failed:", error.message)
    return null
  }
  if (!data) return null

  return {
    scraped: data.scraped as ScrapedGig,
    analysis: data.analysis as GigAnalysis,
    cachedAt: data.created_at as string,
  }
}

/**
 * Persist a fresh analysis. Inserts a new row (history-preserving) rather
 * than upserting, so we can analyze a gig multiple times over its lifetime.
 *
 * `userId` is required so analyses appear in the user's history and count
 * toward their quota.
 *
 * Returns the inserted row id (or null on infra failure). The id is what
 * the share-link flow needs — without it the UI hides the Share button.
 */
export async function storeAnalysis(
  url: string,
  userId: string,
  scraped: ScrapedGig,
  analysis: GigAnalysis,
): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return null

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      url: normalizeUrl(url),
      user_id: userId,
      scraped,
      analysis,
    })
    .select("id")
    .maybeSingle()

  if (error) {
    console.error("[cache] store failed:", error.message)
    return null
  }
  return (data?.id as string | undefined) ?? null
}
