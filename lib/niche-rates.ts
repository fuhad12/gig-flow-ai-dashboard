/**
 * Niche-aware Upwork/Fiverr rate bands.
 *
 * Anchored to published Upwork category medians / typical ranges (2025–2026):
 * web ~$15–50 (median ~$30), writing ~$15–40 (median ~$25), marketing ~$15–45,
 * design ~$15–35, VA ~$10–20, AI/ML much higher. Stage then picks entry vs mid vs premium
 * within that niche — a struggling writer must not get a web-dev or AI rate.
 */

import type { AccountStage, ProfilePlatform } from "@/lib/profile-optimizer-types"

export type RateFamily =
  | "ai_ml"
  | "data"
  | "web_dev"
  | "mobile"
  | "no_code"
  | "design"
  | "video_audio"
  | "writing"
  | "marketing"
  | "admin"
  | "general"

/** Market anchors (USD/hr on Upwork). */
const MARKET: Record<
  RateFamily,
  { low: number; median: number; high: number; label: string }
> = {
  ai_ml: { low: 40, median: 85, high: 160, label: "AI / ML" },
  data: { low: 25, median: 45, high: 100, label: "Data / analytics" },
  web_dev: { low: 15, median: 30, high: 55, label: "Web development" },
  mobile: { low: 18, median: 28, high: 45, label: "Mobile apps" },
  no_code: { low: 15, median: 28, high: 50, label: "No-code / automation" },
  design: { low: 15, median: 25, high: 40, label: "Design" },
  video_audio: { low: 12, median: 30, high: 55, label: "Video / voice" },
  writing: { low: 12, median: 25, high: 40, label: "Writing / copy" },
  marketing: { low: 12, median: 25, high: 45, label: "Marketing / SEO / email" },
  admin: { low: 8, median: 13, high: 22, label: "Admin / VA" },
  general: { low: 12, median: 25, high: 45, label: "General freelance" },
}

/** Catalog niche slug → rate family. */
const SLUG_FAMILY: Record<string, RateFamily> = {
  "ai-apps": "ai_ml",
  "web-development": "web_dev",
  "no-code": "no_code",
  "mobile-apps": "mobile",
  "data-science": "data",
  "logo-design": "design",
  "ui-ux": "design",
  illustration: "design",
  "video-editing": "video_audio",
  voiceover: "video_audio",
  "content-writing": "writing",
  copywriting: "writing",
  translation: "writing",
  seo: "marketing",
  "social-media": "marketing",
  "virtual-assistant": "admin",
}

const KEYWORD_FAMILY: Array<{ family: RateFamily; patterns: RegExp[] }> = [
  {
    family: "ai_ml",
    patterns: [
      /\bai\b/i,
      /machine learning|\bml\b|langchain|llm|openai|rag\b|gpt/i,
    ],
  },
  {
    family: "data",
    patterns: [
      /data science|data analy|python data|sql\b|tableau|power bi/i,
    ],
  },
  {
    family: "web_dev",
    patterns: [
      /web develop|full.?stack|front.?end|back.?end|next\.?js|react|node\.?js|wordpress|shopify|saas/i,
    ],
  },
  {
    family: "mobile",
    patterns: [/mobile app|react native|flutter|ios\b|android app/i],
  },
  {
    family: "no_code",
    patterns: [/no.?code|bubble\.io|webflow|zapier|make\.com|n8n|airtable/i],
  },
  {
    family: "design",
    patterns: [
      /logo design|ui\/?ux|graphic design|figma|brand identity|illustration/i,
    ],
  },
  {
    family: "video_audio",
    patterns: [
      /video edit|motion graphics|voice.?over|voiceover|premiere|davinci/i,
    ],
  },
  {
    family: "writing",
    patterns: [
      /content writ|copywrit|ghostwrit|blog writer|article writer|translation/i,
    ],
  },
  {
    family: "marketing",
    patterns: [
      /email market|klaviyo|seo\b|social media market|ppc|google ads|meta ads|lead gen/i,
    ],
  },
  {
    family: "admin",
    patterns: [
      /virtual assistant|\bva\b|data entry|admin support|customer support/i,
    ],
  },
]

export function rateFamilyLabel(family: RateFamily): string {
  return MARKET[family].label
}

/**
 * Detect rate family from Settings niches + scraped profile text.
 * Settings niches win when present; otherwise keyword scan.
 */
export function detectRateFamily(input: {
  nicheSlugs?: string[]
  profileText?: string
}): RateFamily {
  for (const slug of input.nicheSlugs ?? []) {
    const family = SLUG_FAMILY[slug]
    if (family) return family
  }

  const text = (input.profileText ?? "").slice(0, 8000)
  if (!text.trim()) return "general"

  // Score keyword hits — first strong family with most matches wins.
  let best: RateFamily = "general"
  let bestHits = 0
  for (const row of KEYWORD_FAMILY) {
    let hits = 0
    for (const re of row.patterns) {
      if (re.test(text)) hits += 1
    }
    if (hits > bestHits) {
      bestHits = hits
      best = row.family
    }
  }
  return bestHits > 0 ? best : "general"
}

function roundDollar(n: number): number {
  return Math.max(5, Math.round(n))
}

/**
 * Stage × niche band (Upwork hourly). Entry stays near niche floor;
 * established can approach niche high — never a cross-niche premium leap.
 */
export function rateBandForNicheStage(
  platform: ProfilePlatform,
  stage: AccountStage,
  family: RateFamily,
): { min: number; max: number; target: number; family: RateFamily; label: string } {
  const m = MARKET[family]

  if (platform === "fiverr") {
    // Package prices roughly 1–3× hourly anchors for starter gigs.
    switch (stage) {
      case "getting_started":
        return {
          family,
          label: m.label,
          min: roundDollar(m.low),
          max: roundDollar(m.median * 1.5),
          target: roundDollar(m.low * 1.4),
        }
      case "building_proof":
        return {
          family,
          label: m.label,
          min: roundDollar(m.low * 1.2),
          max: roundDollar(m.median * 2.2),
          target: roundDollar(m.median * 1.3),
        }
      case "established":
        return {
          family,
          label: m.label,
          min: roundDollar(m.median),
          max: roundDollar(m.high * 3),
          target: roundDollar(m.median * 2),
        }
    }
  }

  switch (stage) {
    case "getting_started":
      // Entry: near niche low, capped below median so struggling sellers stay hireable.
      return {
        family,
        label: m.label,
        min: roundDollar(m.low),
        max: roundDollar(Math.min(m.median * 0.95, m.low + 18)),
        target: roundDollar((m.low + Math.min(m.median * 0.75, m.low + 12)) / 2),
      }
    case "building_proof":
      return {
        family,
        label: m.label,
        min: roundDollar(m.low + 5),
        max: roundDollar(m.median + 8),
        target: roundDollar(m.median),
      }
    case "established":
      return {
        family,
        label: m.label,
        min: roundDollar(m.median),
        max: roundDollar(m.high),
        target: roundDollar((m.median + m.high) / 2),
      }
  }
}
