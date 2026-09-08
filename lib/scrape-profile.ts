/**
 * Scrape a public Fiverr or Upwork seller profile into structured text
 * for the Profile Optimizer. Uses Firecrawl extract when configured;
 * falls back to a deterministic mock in local/dev without a key.
 */

import { z } from "zod"

import type { ProfilePlatform } from "@/lib/profile-optimizer-types"

export interface ScrapedSellerProfile {
  platform: ProfilePlatform
  sourceUrl: string
  displayName: string
  headline: string
  overview: string
  skills: string[]
  /** Named clients / companies / people explicitly on the profile. */
  namedClients: string[]
  /** Employment / contract lines (role + company) from work history. */
  workHistory: string[]
  /** Portfolio / published project titles. */
  portfolioTitles: string[]
  /** Flattened text fed to the LLM. */
  profileText: string
}

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape"

const profileExtractionSchema = {
  type: "object",
  properties: {
    displayName: {
      type: "string",
      description: "Seller / freelancer display name on the profile.",
    },
    headline: {
      type: "string",
      description:
        "Fiverr professional title OR Upwork profile title/headline visible on the page.",
    },
    overview: {
      type: "string",
      description:
        "Full About / Description / Overview / bio text from the profile. Preserve paragraphs. Do not invent.",
    },
    skills: {
      type: "array",
      items: { type: "string" },
      description: "Skills, specialties, or tags listed on the profile.",
    },
    namedClients: {
      type: "array",
      items: { type: "string" },
      description:
        "Real client, company, or person names explicitly mentioned on the profile (overview, employment, reviews, portfolio captions). Empty if none. Never invent.",
    },
    workHistory: {
      type: "array",
      items: { type: "string" },
      description:
        "Short employment/contract lines as Role at Company (or similar) from work history. Empty if none. Never invent.",
    },
    portfolioTitles: {
      type: "array",
      items: { type: "string" },
      description:
        "Published portfolio / project titles visible on the profile. Empty if none. Never invent.",
    },
  },
  required: [
    "displayName",
    "headline",
    "overview",
    "skills",
    "namedClients",
    "workHistory",
    "portfolioTitles",
  ],
} as const

const ExtractedSchema = z.object({
  displayName: z.string().default(""),
  headline: z.string().default(""),
  overview: z.string().default(""),
  skills: z.array(z.string()).default([]),
  namedClients: z.array(z.string()).default([]),
  workHistory: z.array(z.string()).default([]),
  portfolioTitles: z.array(z.string()).default([]),
})

interface FirecrawlResponse {
  success: boolean
  data?: { json?: unknown; markdown?: string }
  warning?: string
  error?: string
}

function flattenProfile(parts: {
  displayName: string
  headline: string
  overview: string
  skills: string[]
  namedClients: string[]
  workHistory: string[]
  portfolioTitles: string[]
}): string {
  const lines = [
    parts.displayName ? `Name: ${parts.displayName}` : null,
    parts.headline ? `Title / Headline: ${parts.headline}` : null,
    parts.overview ? `Overview:\n${parts.overview}` : null,
    parts.skills.length > 0
      ? `Skills:\n${parts.skills.map((s) => `- ${s}`).join("\n")}`
      : null,
    parts.namedClients.length > 0
      ? `Named clients / people / companies (ONLY these may be cited as clients):\n${parts.namedClients.map((s) => `- ${s}`).join("\n")}`
      : "Named clients / people / companies: (none found — do NOT invent any)",
    parts.workHistory.length > 0
      ? `Work history:\n${parts.workHistory.map((s) => `- ${s}`).join("\n")}`
      : null,
    parts.portfolioTitles.length > 0
      ? `Portfolio titles:\n${parts.portfolioTitles.map((s) => `- ${s}`).join("\n")}`
      : null,
  ].filter(Boolean)
  return lines.join("\n\n").trim()
}

/**
 * Scrape a public seller profile URL into structured fields.
 * Requires FIRECRAWL_API_KEY in production; mock in non-production without it.
 */
export async function scrapeSellerProfile(
  url: string,
  platform: ProfilePlatform,
): Promise<ScrapedSellerProfile> {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY
  if (firecrawlKey) {
    return firecrawlScrapeProfile(url, platform, firecrawlKey)
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Profile scraping is not configured (FIRECRAWL_API_KEY missing). Add the key or paste is unavailable — contact support.",
    )
  }

  console.warn(
    "[scrape-profile] No FIRECRAWL_API_KEY — returning mock seller profile.",
  )
  return mockProfile(url, platform)
}

async function firecrawlScrapeProfile(
  url: string,
  platform: ProfilePlatform,
  apiKey: string,
): Promise<ScrapedSellerProfile> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  const prompt =
    platform === "fiverr"
      ? "Extract this Fiverr seller profile's display name, professional title, full About/description, skill tags, any named clients/companies mentioned, and portfolio/gig titles. Do NOT invent — use empty string/arrays if missing."
      : "Extract this Upwork freelancer profile's display name, title/headline, FULL Overview/About text, skills, named clients/companies/people mentioned anywhere on the page, employment/work-history lines (role + company), and published portfolio project titles. Do NOT invent — empty string/arrays if missing. Prefer completeness on overview and named entities."

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
        proxy: "stealth",
        waitFor: 4000,
        timeout: 45_000,
        jsonOptions: {
          schema: profileExtractionSchema,
          prompt,
        },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    if ((err as Error).name === "AbortError") {
      throw new Error("Profile scrape timed out after 60 seconds")
    }
    throw new Error(
      `Profile scrape failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  clearTimeout(timeout)

  let body: FirecrawlResponse
  try {
    body = (await res.json()) as FirecrawlResponse
  } catch {
    throw new Error(`Profile scrape returned non-JSON (status ${res.status})`)
  }

  if (!res.ok || !body.success) {
    throw new Error(
      body.error ??
        body.warning ??
        `Could not load this ${platform} profile (status ${res.status}). Make sure the URL is public.`,
    )
  }

  const parsed = ExtractedSchema.safeParse(body.data?.json)
  if (!parsed.success) {
    throw new Error(
      "Could not extract profile fields from that page. Confirm the URL is a public seller/freelancer profile.",
    )
  }

  const data = parsed.data
  const namedClients = data.namedClients.map((s) => s.trim()).filter(Boolean)
  const workHistory = data.workHistory.map((s) => s.trim()).filter(Boolean)
  const portfolioTitles = data.portfolioTitles
    .map((s) => s.trim())
    .filter(Boolean)
  const skills = data.skills.map((s) => s.trim()).filter(Boolean)
  const flat = {
    displayName: data.displayName.trim(),
    headline: data.headline.trim(),
    overview: data.overview.trim(),
    skills,
    namedClients,
    workHistory,
    portfolioTitles,
  }
  const profileText = flattenProfile(flat)
  if (profileText.length < 40) {
    throw new Error(
      "That profile page didn't return enough public text. Check the URL is public and try again.",
    )
  }

  return {
    platform,
    sourceUrl: url,
    ...flat,
    profileText,
  }
}

function mockProfile(
  url: string,
  platform: ProfilePlatform,
): ScrapedSellerProfile {
  let handle = "freelancer"
  try {
    const path = new URL(url).pathname.split("/").filter(Boolean)
    handle = path[path.length - 1] || handle
  } catch {
    // ignore
  }

  const headline =
    platform === "fiverr"
      ? "I will do web development and design"
      : "Full Stack Developer | Web | App | Everything"
  const overview =
    platform === "fiverr"
      ? `Hi I am ${handle}. I am a passionate freelancer with many years of experience. I leverage cutting-edge solutions to deliver seamless experiences. Contact me for any project.`
      : `Hello! I am a hardworking professional specializing in many technologies. I would love the opportunity to work with you on your next project. Looking forward to hearing from you.`
  const skills =
    platform === "fiverr"
      ? ["web development", "design", "javascript", "html", "css"]
      : ["JavaScript", "React", "Node.js", "Communication", "Hard work"]

  const displayName = handle
  const namedClients: string[] = []
  const workHistory: string[] = []
  const portfolioTitles: string[] = []
  return {
    platform,
    sourceUrl: url,
    displayName,
    headline,
    overview,
    skills,
    namedClients,
    workHistory,
    portfolioTitles,
    profileText: flattenProfile({
      displayName,
      headline,
      overview,
      skills,
      namedClients,
      workHistory,
      portfolioTitles,
    }),
  }
}
