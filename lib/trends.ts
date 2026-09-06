import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { scrapeFiverrSearch, type ScrapedSearchGig } from "@/lib/scraper"
import { getNiche, type NicheDef } from "@/lib/niches"

const TABLE = "niche_gigs"
const FRESH_HOURS = 168 // refresh weekly

// ---------- Types ----------

export interface NicheGig {
  url: string
  title: string
  price: number | null
  rating: number | null
  reviewCount: number | null
  sellerLevel: string | null
  position: number
}

export interface KeywordCount {
  keyword: string
  count: number
}

export interface PriceStats {
  count: number
  min: number | null
  max: number | null
  median: number | null
  average: number | null
}

export interface NicheSnapshot {
  slug: string
  name: string
  scrapedAt: string | null
  fresh: boolean
  gigs: NicheGig[]
  keywords: KeywordCount[]
  priceStats: PriceStats
}

// ---------- Stopwords for keyword extraction ----------

const STOPWORDS = new Set([
  "i",
  "will",
  "you",
  "your",
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "by",
  "any",
  "my",
  "this",
  "that",
  "it",
  "is",
  "be",
  "do",
  "make",
  "create",
  "build",
  "design",
  "develop",
  "professional",
  "best",
  "amazing",
  "high",
  "quality",
  "custom",
  "fast",
  "modern",
  "responsive",
  "from",
  "into",
  "app",
  "apps",
  "website",
  "websites",
  "web",
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-./]+|[-./]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

export function aggregateKeywords(
  gigs: NicheGig[],
  topN = 24,
): KeywordCount[] {
  const counts = new Map<string, number>()
  for (const g of gigs) {
    const seen = new Set<string>()
    for (const tok of tokenize(g.title)) {
      if (seen.has(tok)) continue
      seen.add(tok)
      counts.set(tok, (counts.get(tok) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN)
}

export function priceStats(gigs: NicheGig[]): PriceStats {
  const prices = gigs
    .map((g) => g.price)
    .filter((p): p is number => typeof p === "number" && p > 0)
    .sort((a, b) => a - b)

  if (prices.length === 0) {
    return { count: 0, min: null, max: null, median: null, average: null }
  }

  const mid = Math.floor(prices.length / 2)
  const median =
    prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid]
  const average = prices.reduce((a, b) => a + b, 0) / prices.length

  return {
    count: prices.length,
    min: prices[0],
    max: prices[prices.length - 1],
    median: Math.round(median * 100) / 100,
    average: Math.round(average * 100) / 100,
  }
}

// ---------- DB access ----------

async function readLatestGigs(
  slug: string,
): Promise<{ gigs: NicheGig[]; scrapedAt: string | null }> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return { gigs: [], scrapedAt: null }

  // Pull every gig from the most-recent scrape batch for this niche. We treat
  // rows with the same `scraped_at` (to the second) as one snapshot.
  const { data: latest, error: latestErr } = await supabase
    .from(TABLE)
    .select("scraped_at")
    .eq("niche_slug", slug)
    .order("scraped_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestErr || !latest) return { gigs: [], scrapedAt: null }
  const scrapedAt = latest.scraped_at as string

  const { data: rows, error: rowsErr } = await supabase
    .from(TABLE)
    .select("url, title, price, rating, review_count, seller_level, position")
    .eq("niche_slug", slug)
    .eq("scraped_at", scrapedAt)
    .order("position", { ascending: true })

  if (rowsErr || !rows) return { gigs: [], scrapedAt }

  const gigs: NicheGig[] = rows.map((r) => ({
    url: r.url as string,
    title: r.title as string,
    price: (r.price as number | null) ?? null,
    rating: (r.rating as number | null) ?? null,
    reviewCount: (r.review_count as number | null) ?? null,
    sellerLevel: (r.seller_level as string | null) ?? null,
    position: (r.position as number) ?? 0,
  }))

  return { gigs, scrapedAt }
}

async function writeSnapshot(
  slug: string,
  scraped: ScrapedSearchGig[],
): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase || scraped.length === 0) return null

  const scrapedAt = new Date().toISOString()
  const rows = scraped.map((g) => ({
    niche_slug: slug,
    url: g.url,
    title: g.title,
    price: g.price,
    rating: g.rating,
    review_count: g.reviewCount,
    seller_level: g.sellerLevel,
    position: g.position,
    scraped_at: scrapedAt,
  }))

  const { error } = await supabase.from(TABLE).insert(rows)
  if (error) {
    console.error("[trends] insert failed:", error.message)
    return null
  }
  return scrapedAt
}

// ---------- Public API ----------

function buildSnapshot(
  niche: NicheDef,
  gigs: NicheGig[],
  scrapedAt: string | null,
  fresh: boolean,
): NicheSnapshot {
  return {
    slug: niche.slug,
    name: niche.name,
    scrapedAt,
    fresh,
    gigs,
    keywords: aggregateKeywords(gigs),
    priceStats: priceStats(gigs),
  }
}

function isFresh(scrapedAt: string | null): boolean {
  if (!scrapedAt) return false
  const ageMs = Date.now() - new Date(scrapedAt).getTime()
  return ageMs < FRESH_HOURS * 3600_000
}

/**
 * Read-only: return cached snapshots for every niche we have data for.
 * Never scrapes — safe to call from latency-sensitive paths like /api/analyze.
 */
export async function getAllCachedSnapshots(): Promise<NicheSnapshot[]> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return []

  const out: NicheSnapshot[] = []
  for (const niche of (await import("@/lib/niches")).NICHES) {
    const cached = await readLatestGigs(niche.slug)
    if (cached.gigs.length === 0) continue
    out.push(
      buildSnapshot(niche, cached.gigs, cached.scrapedAt, isFresh(cached.scrapedAt)),
    )
  }
  return out
}

/**
 * Return a niche snapshot, scraping on cache miss / staleness.
 *
 * Options:
 *   - `refresh: true`  — bypass the cache and always re-scrape.
 *   - `readOnly: true` — never scrape. Serves whatever's in cache, even
 *                       if stale, and returns an empty snapshot when no
 *                       cache exists. Used to gate Firecrawl spend for
 *                       users who've exhausted their AI-credit pool —
 *                       they can keep browsing what's already cached
 *                       without us paying for fresh scrapes.
 *
 * `readOnly` overrides `refresh` (a user who can't scrape can't refresh).
 */
export async function getNicheSnapshot(
  slug: string,
  options: { refresh?: boolean; readOnly?: boolean } = {},
): Promise<NicheSnapshot> {
  const niche = getNiche(slug)
  if (!niche) throw new Error(`Unknown niche slug: ${slug}`)

  if (options.readOnly) {
    const cached = await readLatestGigs(slug)
    return buildSnapshot(niche, cached.gigs, cached.scrapedAt, true)
  }

  if (!options.refresh) {
    const cached = await readLatestGigs(slug)
    if (cached.gigs.length > 0 && isFresh(cached.scrapedAt)) {
      return buildSnapshot(niche, cached.gigs, cached.scrapedAt, true)
    }
  }

  // Cache miss or stale: scrape.
  let scraped: ScrapedSearchGig[]
  try {
    scraped = await scrapeFiverrSearch(niche.searchUrl)
  } catch (err) {
    // If we have stale data, serve it rather than 502-ing the user.
    const cached = await readLatestGigs(slug)
    if (cached.gigs.length > 0) {
      return buildSnapshot(niche, cached.gigs, cached.scrapedAt, false)
    }
    throw err
  }

  const scrapedAt = (await writeSnapshot(slug, scraped)) ?? new Date().toISOString()
  const gigs: NicheGig[] = scraped.map((g) => ({
    url: g.url,
    title: g.title,
    price: g.price,
    rating: g.rating,
    reviewCount: g.reviewCount,
    sellerLevel: g.sellerLevel,
    position: g.position,
  }))

  return buildSnapshot(niche, gigs, scrapedAt, true)
}
