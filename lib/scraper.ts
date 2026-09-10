import { z } from "zod"

import type { ScrapedGig, ScrapedSearchGig } from "@/lib/analysis-types"

export type { ScrapedSearchGig }

// ---------- Public surface ----------

/**
 * Scrape a Fiverr gig page into a normalized {@link ScrapedGig}.
 *
 * Strategy (first match wins):
 *   1. Resolve Fiverr short share links (`fiverr.com/s/...`) to the
 *      canonical gig URL when possible.
 *   2. If `APIFY_API_TOKEN` is set → Apify Fiverr Actor (preferred free path).
 *   3. Else if `FIRECRAWL_API_KEY` is set → Firecrawl stealth scrape.
 *   4. Else → deterministic mock so local UI still works.
 */
export async function scrapeFiverrGig(url: string): Promise<ScrapedGig> {
  const resolvedUrl = await resolveFiverrShortUrl(url)

  const { getApifyToken, apifyScrapeFiverrGig } = await import(
    "@/lib/apify-fiverr"
  )

  if (getApifyToken()) {
    return apifyScrapeFiverrGig(resolvedUrl)
  }

  const firecrawlKey = process.env.FIRECRAWL_API_KEY
  if (firecrawlKey) {
    return firecrawlScrape(resolvedUrl, firecrawlKey)
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[scraper] No APIFY_API_TOKEN or FIRECRAWL_API_KEY — returning mock gig data.",
    )
  }
  return mockScrape(resolvedUrl)
}

// ---------- Fiverr short-URL resolver ----------

/**
 * Pattern for Fiverr's mobile-share / deep-link short URLs.
 * Example: `https://www.fiverr.com/s/1q8Pdbp` or `https://fiverr.com/share/xyz123`
 *
 * These shortened links typically only render in Fiverr's mobile app
 * or via authenticated browser session. Server-side fetches often get
 * a 302 to `/` (homepage) — NOT the canonical gig URL — so we must
 * never treat "redirected away from /s/" as success unless the final
 * URL is a real seller/gig path.
 */
const FIVERR_SHORT_URL_RE =
  /^https?:\/\/(?:www\.)?fiverr\.com\/(?:s|share)\/[a-zA-Z0-9_-]+\/?$/i

/** Paths that are never a seller username on a gig detail page. */
const FIVERR_RESERVED_SEGMENTS = new Set([
  "s",
  "share",
  "categories",
  "search",
  "gigs",
  "login",
  "join",
  "start_selling",
  "inspire",
  "business",
  "pro",
  "logo-maker",
  "messages",
  "inbox",
  "users",
  "interest-page",
])

const SHORT_LINK_HELP =
  "This looks like a Fiverr mobile share link (fiverr.com/s/...). " +
  "Open it in your browser, then copy the full URL from the address bar — " +
  "it should look like https://www.fiverr.com/<seller>/<gig-name>. Paste that instead."

/**
 * True when the URL is a canonical gig detail page:
 * `https://www.fiverr.com/<seller>/<gig-slug>`.
 */
export function isFiverrGigDetailUrl(input: string): boolean {
  try {
    const u = new URL(input.trim())
    if (!/(^|\.)fiverr\.com$/i.test(u.hostname)) return false
    const parts = u.pathname.split("/").filter(Boolean)
    if (parts.length < 2) return false
    const [seller, slug] = parts
    if (!seller || !slug) return false
    if (FIVERR_RESERVED_SEGMENTS.has(seller.toLowerCase())) return false
    if (FIVERR_SHORT_URL_RE.test(u.origin + u.pathname)) return false
    return true
  } catch {
    return false
  }
}

/**
 * Browser-shaped headers so the redirect host doesn't immediately
 * 403/404 us as a bot. Doesn't bypass Fiverr's full anti-bot stack,
 * but it's enough to get the 301/302 redirect response on the share
 * route specifically.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
}

function absoluteFiverrUrl(location: string, base: string): string {
  try {
    return new URL(location, base).href
  } catch {
    return location
  }
}

async function resolveFiverrShortUrl(input: string): Promise<string> {
  const url = input.trim()
  if (!FIVERR_SHORT_URL_RE.test(url)) {
    // Already a full URL — still guard against homepage / junk.
    if (isFiverrGigDetailUrl(url)) return url
    if (/fiverr\.com/i.test(url) && !isFiverrGigDetailUrl(url)) {
      throw new Error(
        "That Fiverr link doesn't look like a gig page. Paste a URL like " +
          "https://www.fiverr.com/<seller>/<gig-name> (open the gig, then copy from the address bar).",
      )
    }
    return url
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    // Prefer manual redirect so we can inspect Location. Fiverr share
    // links currently 302 to `/` for servers — that must NOT count as
    // a resolved gig URL (old bug: follow redirects → scrape homepage → 502).
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    })

    const location = res.headers.get("location")
    if (location) {
      const next = absoluteFiverrUrl(location, url)
      if (isFiverrGigDetailUrl(next)) return next
    }

    // Some environments still follow once; check final URL if present.
    if (res.url && isFiverrGigDetailUrl(res.url)) return res.url

    throw new Error(SHORT_LINK_HELP)
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Couldn't resolve the Fiverr share link in time. Open it in your " +
          "browser and paste the full canonical URL instead.",
      )
    }
    if (err instanceof Error && err.message.includes("fiverr.com/s/")) {
      throw err
    }
    if (err instanceof Error && err.message.includes("doesn't look like a gig")) {
      throw err
    }
    // Network glitch — still refuse to scrape the raw short URL; scrapers
    // almost never get usable gig JSON from /s/ links.
    throw new Error(SHORT_LINK_HELP)
  } finally {
    clearTimeout(timeout)
  }
}

// ---------- Firecrawl integration ----------

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape"

/**
 * JSON Schema describing the shape we want Firecrawl's LLM extractor to
 * produce. Firecrawl uses this both to constrain the model and to validate
 * its own output before returning to us.
 */
const firecrawlExtractionSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "The full gig title as shown on the page (e.g. starts with 'I will...').",
    },
    description: {
      type: "string",
      description: "The main gig description / body copy, including any 'About this gig' content.",
    },
    thumbnailUrl: {
      type: ["string", "null"],
      description:
        "Absolute URL of the primary gig thumbnail/cover image (the first image in the gallery, not the seller's avatar). Most Fiverr thumbnails live on fiverr-res.cloudinary.com. Return null if no image is visible.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Search tags / keywords associated with the gig. Empty array if none are visible.",
    },
    packages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Package name (e.g. 'Basic', 'Standard', 'Premium').",
          },
          price: {
            type: "number",
            description: "Numeric package price in USD. If the page shows another currency, convert to USD if possible, otherwise return the displayed number.",
          },
          details: {
            type: "string",
            description: "Short description of what the package includes.",
          },
        },
        required: ["name", "price", "details"],
      },
      description: "Pricing tiers offered by the seller.",
    },
  },
  required: ["title", "description", "thumbnailUrl", "tags", "packages"],
} as const

const FirecrawlExtractedSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  thumbnailUrl: z.string().url().nullable().optional(),
  tags: z.array(z.string()),
  packages: z.array(
    z.object({
      name: z.string(),
      price: z.number(),
      details: z.string(),
    }),
  ),
})

interface FirecrawlResponse {
  success: boolean
  data?: {
    json?: unknown
    markdown?: string
    metadata?: Record<string, unknown>
  }
  warning?: string
  error?: string
}

async function firecrawlScrape(
  url: string,
  apiKey: string,
): Promise<ScrapedGig> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  let res: Response
  try {
    res = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["json"],
        onlyMainContent: true,
        // Fiverr is heavily JS-rendered and bot-protected.
        proxy: "stealth",
        waitFor: 3000,
        timeout: 45_000,
        jsonOptions: {
          schema: firecrawlExtractionSchema,
          prompt:
            "Extract the Fiverr gig's title, full description, primary thumbnail/cover image URL, " +
            "search tags, and pricing packages from the page. The thumbnail is the main gig image " +
            "(usually on fiverr-res.cloudinary.com), NOT the seller's avatar. " +
            "If any field is missing on the page, return an empty string, empty array, or null — do not fabricate values.",
        },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    if ((err as Error).name === "AbortError") {
      throw new Error("Firecrawl request timed out after 60 seconds")
    }
    throw new Error(
      `Firecrawl request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  clearTimeout(timeout)

  let body: FirecrawlResponse
  try {
    body = (await res.json()) as FirecrawlResponse
  } catch {
    throw new Error(
      `Firecrawl returned a non-JSON response (status ${res.status})`,
    )
  }

  if (!res.ok || !body.success) {
    throw new Error(
      body.error ??
        `Firecrawl returned status ${res.status}${body.warning ? ` (${body.warning})` : ""}`,
    )
  }

  const json = body.data?.json
  if (!json) {
    throw new Error("Firecrawl response did not include extracted JSON data")
  }

  const parsed = FirecrawlExtractedSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Firecrawl extraction did not match expected schema: ${parsed.error.message}`,
    )
  }

  return {
    sourceUrl: url,
    thumbnailUrl: parsed.data.thumbnailUrl ?? null,
    title: parsed.data.title,
    description: parsed.data.description,
    tags: parsed.data.tags,
    packages: parsed.data.packages,
  }
}

// ---------- Search results scraper ----------

const firecrawlSearchSchema = {
  type: "object",
  properties: {
    gigs: {
      type: "array",
      description:
        "Top gig listings on the page in display order. Up to 20 entries.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Gig title text (often starts with 'I will...').",
          },
          url: {
            type: "string",
            description:
              "Absolute URL to the gig detail page. If the page uses relative URLs, prefix with https://www.fiverr.com.",
          },
          price: {
            type: ["number", "null"],
            description: "Starting price in USD as a number, or null if not visible.",
          },
          rating: {
            type: ["number", "null"],
            description: "Average star rating 0-5, or null if no reviews.",
          },
          reviewCount: {
            type: ["integer", "null"],
            description: "Total number of reviews, or null if not visible.",
          },
          sellerLevel: {
            type: ["string", "null"],
            description:
              "Seller level label such as 'Level 1', 'Level 2', 'Top Rated', 'Pro' — null if not shown.",
          },
        },
        required: ["title", "url"],
      },
    },
  },
  required: ["gigs"],
} as const

const FirecrawlSearchSchema = z.object({
  gigs: z
    .array(
      z.object({
        title: z.string().min(1),
        url: z.string().url(),
        price: z.number().nullable().optional(),
        rating: z.number().nullable().optional(),
        reviewCount: z.number().int().nullable().optional(),
        sellerLevel: z.string().nullable().optional(),
      }),
    )
    .max(50),
})

/**
 * Scrape a Fiverr search/category page and return the top gigs in display
 * order. Prefers Apify when configured, then Firecrawl, then mock.
 */
export async function scrapeFiverrSearch(
  searchUrl: string,
): Promise<ScrapedSearchGig[]> {
  const { getApifyToken, apifyScrapeFiverrSearch } = await import(
    "@/lib/apify-fiverr"
  )

  if (getApifyToken()) {
    return apifyScrapeFiverrSearch(searchUrl)
  }

  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[scraper] No APIFY_API_TOKEN or FIRECRAWL_API_KEY — returning mock search results.",
      )
    }
    return mockSearch(searchUrl)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  let res: Response
  try {
    res = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ["json"],
        onlyMainContent: true,
        proxy: "stealth",
        waitFor: 4000,
        timeout: 45_000,
        jsonOptions: {
          schema: firecrawlSearchSchema,
          prompt:
            "Extract the gig listings shown on this Fiverr search/category page. " +
            "For each gig card: full title, absolute URL, starting price in USD (number only), " +
            "average rating, total reviews, and seller level if visible. " +
            "Return up to 20 gigs in the order they appear. " +
            "If a field is missing, return null — do not guess.",
        },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    if ((err as Error).name === "AbortError") {
      throw new Error("Firecrawl search request timed out after 60 seconds")
    }
    throw new Error(
      `Firecrawl search request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  clearTimeout(timeout)

  let body: FirecrawlResponse
  try {
    body = (await res.json()) as FirecrawlResponse
  } catch {
    throw new Error(
      `Firecrawl returned a non-JSON response (status ${res.status})`,
    )
  }

  if (!res.ok || !body.success) {
    throw new Error(
      body.error ?? `Firecrawl returned status ${res.status}`,
    )
  }

  const json = body.data?.json
  if (!json) {
    throw new Error("Firecrawl search response did not include extracted JSON")
  }

  const parsed = FirecrawlSearchSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Firecrawl search extraction did not match schema: ${parsed.error.message}`,
    )
  }

  return parsed.data.gigs.map((g, i) => ({
    url: g.url,
    title: g.title,
    price: g.price ?? null,
    rating: g.rating ?? null,
    reviewCount: g.reviewCount ?? null,
    sellerLevel: g.sellerLevel ?? null,
    position: i + 1,
  }))
}

// ---------- Mock fallback ----------

function mockScrape(url: string): ScrapedGig {
  const slug =
    url
      .replace(/\/+$/, "")
      .split("/")
      .pop()
      ?.replace(/-/g, " ") ?? "fiverr gig"

  return {
    sourceUrl: url,
    // Deliberately washed-out placeholder so the AI has something visually
    // weak to critique in mock mode.
    thumbnailUrl:
      "https://placehold.co/700x396/2a2a2a/666666/png?text=Web+Dev+Services",
    title: `I will do web development and website design for you (${slug})`,
    description:
      "Hi! I am a web developer with 5 years of experience. I can build any kind of website for you. " +
      "I use HTML, CSS, JavaScript and React. Contact me for more details.",
    tags: [
      "web development",
      "website",
      "react",
      "javascript",
      "html css",
      "web design",
      "frontend",
      "developer",
      "coding",
      "programming",
    ],
    packages: [
      { name: "Basic", price: 25, details: "Simple website" },
      { name: "Standard", price: 75, details: "Medium website" },
      { name: "Premium", price: 150, details: "Complex website" },
    ],
  }
}

function mockSearch(searchUrl: string): ScrapedSearchGig[] {
  // Tiny set of plausible mock gigs so the trends pipeline is testable
  // without burning Firecrawl credits. Vary slightly by URL so different
  // niches don't all look identical.
  const seed = searchUrl.length % 3
  const titles = [
    [
      "I will build a Next.js SaaS MVP with Cursor AI in 5 days",
      "I will develop your AI app using OpenAI and Supabase",
      "I will create a full stack web app with stripe integration",
      "I will build modern landing pages with shadcn ui and tailwind",
      "I will integrate openai api into your existing application",
      "I will fix bugs and add features in your react nextjs project",
    ],
    [
      "I will build a no code mvp on bubble or flutterflow",
      "I will design and develop a responsive figma to react site",
      "I will create high converting webflow landing pages",
      "I will set up supabase auth database and storage for you",
      "I will build a langchain rag pipeline on your data",
      "I will deploy your app to vercel with ci cd",
    ],
    [
      "I will build a react native expo mobile app",
      "I will design a stunning mobile app ui in figma",
      "I will create swiftui and android jetpack compose screens",
      "I will publish your app to the app store and play store",
      "I will integrate stripe and revenuecat into your app",
      "I will fix mobile app performance and crash issues",
    ],
  ][seed]

  return titles.map((title, i) => ({
    title,
    url: `https://www.fiverr.com/mock-seller-${seed}/gig-${i + 1}`,
    price: [45, 75, 120, 199, 349, 499][i % 6] ?? 99,
    rating: 4.7 + ((i * 7) % 3) * 0.1,
    reviewCount: 50 + i * 41,
    sellerLevel: i < 2 ? "Top Rated" : i < 4 ? "Level 2" : "Level 1",
    position: i + 1,
  }))
}
