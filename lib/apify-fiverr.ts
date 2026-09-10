/**
 * Apify-backed Fiverr scraping.
 *
 * Used as the preferred scraper when `APIFY_API_TOKEN` is set (free $5/mo
 * credits, ready-made Fiverr Actors). Falls back to Firecrawl / mock is
 * handled by `lib/scraper.ts`.
 *
 * Default Actor: `automation-lab/fiverr-scraper` — override with
 * `APIFY_FIVERR_ACTOR_ID` (use `username~actor-name` form).
 */

import type { ScrapedGig, ScrapedSearchGig } from "@/lib/analysis-types"

const APIFY_BASE = "https://api.apify.com/v2"

/** Default public Fiverr Actor. Override via env if you prefer another. */
const DEFAULT_FIVERR_ACTOR = "automation-lab~fiverr-scraper"

export function getApifyToken(): string | null {
  return (
    process.env.APIFY_API_TOKEN?.trim() ||
    process.env.APIFY_TOKEN?.trim() ||
    null
  )
}

function fiverrActorId(): string {
  const raw =
    process.env.APIFY_FIVERR_ACTOR_ID?.trim() || DEFAULT_FIVERR_ACTOR
  // Accept both "user/actor" and "user~actor" forms.
  return raw.replace("/", "~")
}

/**
 * Run an Actor synchronously and return its dataset items.
 * Docs: POST /v2/acts/:actorId/run-sync-get-dataset-items
 *
 * Default timeout is intentionally below Vercel Hobby/Pro function limits
 * so we can fall back to Firecrawl (or return JSON) instead of a bare 502.
 */
async function runActorSync<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  timeoutSec = 45,
): Promise<T[]> {
  const token = getApifyToken()
  if (!token) {
    throw new Error("APIFY_API_TOKEN is not configured")
  }

  const url =
    `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}` +
    `/run-sync-get-dataset-items?timeout=${timeoutSec}&memory=1024`

  const controller = new AbortController()
  // Abort a few seconds after Apify's own timeout so we fail in-process
  // before the platform gateway kills the function with an empty 502.
  const timer = setTimeout(() => controller.abort(), (timeoutSec + 8) * 1000)

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === "AbortError") {
      throw new Error(`Apify Actor timed out after ${timeoutSec}s`)
    }
    throw new Error(
      `Apify request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  clearTimeout(timer)

  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : []
  } catch {
    throw new Error(
      `Apify returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`,
    )
  }

  if (!res.ok) {
    const errObj = body as { error?: { message?: string } }
    throw new Error(
      errObj?.error?.message ??
        `Apify returned status ${res.status}`,
    )
  }

  if (!Array.isArray(body)) {
    throw new Error("Apify dataset response was not an array")
  }
  return body as T[]
}

// ---------- Gig detail ----------

/**
 * Scrape a single Fiverr gig URL via Apify and map to ScrapedGig.
 */
export async function apifyScrapeFiverrGig(url: string): Promise<ScrapedGig> {
  const actorId = fiverrActorId()
  const items = await runActorSync(actorId, {
    // Common input shapes across Fiverr Actors — unused keys are ignored.
    startUrls: [{ url }],
    urls: [url],
    gigUrls: [url],
    maxItems: 1,
    maxGigs: 1,
    includeGigDetails: true,
    scrapeGigDetails: true,
    enrichDetails: true,
  })

  if (items.length === 0) {
    throw new Error(
      "Apify returned no results for this gig URL. The gig may be private, removed, or the Actor input shape may need adjusting (set APIFY_FIVERR_ACTOR_ID).",
    )
  }

  return mapItemToScrapedGig(items[0], url)
}

function mapItemToScrapedGig(
  raw: Record<string, unknown>,
  fallbackUrl: string,
): ScrapedGig {
  const title = pickString(raw, [
    "title",
    "gigTitle",
    "name",
    "gig_title",
  ])
  const description = pickString(raw, [
    "description",
    "gigDescription",
    "about",
    "aboutThisGig",
    "gig_description",
    "fullDescription",
  ])
  const sourceUrl =
    pickString(raw, ["url", "gigUrl", "link", "gig_url"]) || fallbackUrl

  if (!title || !description) {
    throw new Error(
      "Apify result missing title/description. Try a different Fiverr Actor or check the Actor output fields.",
    )
  }

  const tags = pickStringArray(raw, [
    "tags",
    "searchTags",
    "keywords",
    "metadata",
  ])

  const packages = pickPackages(raw)
  const thumbnailUrl =
    pickString(raw, [
      "thumbnailUrl",
      "thumbnail",
      "image",
      "imageUrl",
      "coverImage",
      "gigImage",
    ]) ||
    pickFirstImage(raw) ||
    null

  return {
    sourceUrl,
    thumbnailUrl,
    title,
    description,
    tags: tags.slice(0, 10),
    packages,
  }
}

// ---------- Search ----------

/**
 * Scrape a Fiverr search/category page via Apify.
 */
export async function apifyScrapeFiverrSearch(
  searchUrl: string,
): Promise<ScrapedSearchGig[]> {
  const actorId = fiverrActorId()
  const items = await runActorSync(actorId, {
    startUrls: [{ url: searchUrl }],
    urls: [searchUrl],
    searchUrls: [searchUrl],
    maxItems: 20,
    maxGigs: 20,
    includeGigDetails: false,
    scrapeGigDetails: false,
  })

  return items.slice(0, 20).map((raw, i) => {
    const r = raw as Record<string, unknown>
    return {
      url:
        pickString(r, ["url", "gigUrl", "link", "gig_url"]) ||
        searchUrl,
      title:
        pickString(r, ["title", "gigTitle", "name"]) || "Untitled gig",
      price: pickNumber(r, ["price", "startingPrice", "fromPrice", "priceFrom"]),
      rating: pickNumber(r, ["rating", "averageRating", "stars"]),
      reviewCount: pickNumber(r, [
        "reviewCount",
        "reviews",
        "reviewsCount",
        "ratingCount",
      ]),
      sellerLevel: pickString(r, [
        "sellerLevel",
        "level",
        "seller_level",
      ]),
      position: i + 1,
    }
  })
}

// ---------- Field helpers ----------

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const n = Number(v.replace(/[^0-9.]/g, ""))
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function pickStringArray(
  obj: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const k of keys) {
    const v = obj[k]
    if (Array.isArray(v)) {
      return v
        .map((x) => {
          if (typeof x === "string") return x.trim()
          if (x && typeof x === "object" && "name" in x) {
            return String((x as { name: unknown }).name)
          }
          return ""
        })
        .filter(Boolean)
    }
  }
  return []
}

function pickPackages(
  obj: Record<string, unknown>,
): { name: string; price: number; details: string }[] {
  const candidates = [obj.packages, obj.pricing, obj.tiers, obj.packageList]
  for (const c of candidates) {
    if (!Array.isArray(c) || c.length === 0) continue
    return c
      .map((p) => {
        if (!p || typeof p !== "object") return null
        const row = p as Record<string, unknown>
        const name =
          pickString(row, ["name", "tier", "title", "packageName"]) ||
          "Package"
        const price =
          pickNumber(row, ["price", "amount", "cost"]) ?? 0
        const details =
          pickString(row, [
            "details",
            "description",
            "desc",
            "includes",
          ]) || ""
        return { name, price, details }
      })
      .filter((x): x is { name: string; price: number; details: string } =>
        Boolean(x),
      )
  }

  // Some Actors flatten Basic/Standard/Premium as top-level fields.
  const flat: { name: string; price: number; details: string }[] = []
  for (const tier of ["basic", "standard", "premium"] as const) {
    const price = pickNumber(obj, [
      `${tier}Price`,
      `${tier}_price`,
      tier,
    ])
    if (price != null) {
      flat.push({
        name: tier.charAt(0).toUpperCase() + tier.slice(1),
        price,
        details:
          pickString(obj, [
            `${tier}Description`,
            `${tier}Details`,
            `${tier}_description`,
          ]) || "",
      })
    }
  }
  return flat
}

function pickFirstImage(obj: Record<string, unknown>): string | null {
  for (const k of ["images", "gallery", "media", "photos"]) {
    const v = obj[k]
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0]
      if (typeof first === "string") return first
      if (first && typeof first === "object") {
        const row = first as Record<string, unknown>
        return pickString(row, ["url", "src", "image"])
      }
    }
  }
  return null
}
