/**
 * Profile optimizer types — Fiverr seller profile + Upwork freelancer profile.
 * URL-first: scrape public profile, then rewrite.
 */

import type { RateFamily } from "@/lib/niche-rates"
import { rateBandForNicheStage } from "@/lib/niche-rates"
import type { VisibilityChecklistItem } from "@/lib/visibility-types"

export type { RateFamily } from "@/lib/niche-rates"

export type ProfilePlatform = "fiverr" | "upwork"

export type ProfileVerdict = "needs_work" | "solid" | "strong"

/**
 * Where the seller is in the proof / traction ladder.
 * Drives rate advice — struggling accounts must not get premium rates.
 */
export type AccountStage =
  | "getting_started"
  | "building_proof"
  | "established"

export interface ProfileOptimizeInput {
  /** Public profile URL (fiverr.com/... or upwork.com/...). */
  profileUrl: string
  /** Detected or user-selected platform. */
  platform: ProfilePlatform
  /** Scraped (or pasted) visible profile content. */
  profileText: string
  tone?: "professional" | "friendly" | "direct"
  /** Optional scrape signals used to stage rate advice. */
  signals?: {
    namedClients: number
    portfolioTitles: number
    workHistory: number
    overviewLength: number
  }
  /** Settings niche slugs — used to pick niche rate family. */
  nicheSlugs?: string[]
}

export interface ProfileOptimization {
  platform: ProfilePlatform
  /** Overall professionalism / conversion readiness 0-100 of the CURRENT profile. */
  score: number
  /** Plain-language verdict for the UI. */
  verdict: ProfileVerdict
  /** One-line summary for the user (e.g. needs more professional positioning). */
  verdictLabel: string
  /** Paste-ready headline (Upwork) or professional title (Fiverr). */
  headline: string
  /** Paste-ready overview / about / description. */
  overview: string
  /** Suggested skills / specialties (platform-appropriate labels). */
  skills: string[]
  /**
   * Suggested profile rate in USD.
   * Upwork: hourly rate. Fiverr: suggested starting package price (or null).
   * Staged + niche-aware: early writers ≠ early web devs ≠ AI specialists.
   */
  suggestedRateUsd: number | null
  /** Short label for the rate (e.g. "Suggested hourly rate"). */
  suggestedRateLabel: string
  /** One-line why this rate fits (no invented credentials). */
  suggestedRateNote: string
  /** Traction stage inferred for pricing + action plan. */
  accountStage: AccountStage
  /** Short UI label for the stage. */
  accountStageLabel: string
  /** Niche rate family used for the band (web_dev, writing, marketing…). */
  rateFamily: RateFamily
  /** Human label for the niche band (e.g. "Web development"). */
  rateFamilyLabel: string
  /** Why this rewrite should win more clients. */
  winAngles: string[]
  /** Ordered steps to apply on the live profile. */
  actionPlan: Array<{
    title: string
    detail: string
  }>
  /** @deprecated Prefer actionPlan — kept for older clients. */
  editChecklist: string[]
  /** Short critique of the original profile. */
  critique: string[]
  /**
   * GEO: short lines AI / clients can quote — grounded in scrape only.
   * Optional for older cached rows.
   */
  proofQuotes?: string[]
  /** GEO/AIO tips beyond the main action plan. */
  geoTips?: string[]
  /** SEO → AEO → GEO → AIO weekly checklist. */
  visibilityChecklist?: VisibilityChecklistItem[]
  /** Optional scraped snapshot shown in the UI. */
  scraped?: {
    displayName: string
    headline: string
    overview: string
    skills: string[]
  }
}

export interface ProfileOptimizeResponse {
  optimization: ProfileOptimization
}

/** Detect platform from a profile URL hostname. */
export function detectProfilePlatform(url: string): ProfilePlatform | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes("fiverr.com")) return "fiverr"
    if (host.includes("upwork.com")) return "upwork"
    return null
  } catch {
    return null
  }
}

export function verdictFromScore(score: number): {
  verdict: ProfileVerdict
  verdictLabel: string
} {
  if (score < 60) {
    return {
      verdict: "needs_work",
      verdictLabel:
        "Your profile needs clearer, more professional positioning before it converts well.",
    }
  }
  if (score < 80) {
    return {
      verdict: "solid",
      verdictLabel:
        "Solid foundation — a tighter headline and overview will make you more competitive.",
    }
  }
  return {
    verdict: "strong",
    verdictLabel:
      "Strong profile signals — small polish on specificity and proof will push it further.",
  }
}

export function accountStageLabel(stage: AccountStage): string {
  switch (stage) {
    case "getting_started":
      return "Getting started — win first jobs"
    case "building_proof":
      return "Building proof — raise carefully"
    case "established":
      return "Established — market positioning"
  }
}

/** Soft rate bands by stage × niche (Upwork hourly / Fiverr package USD). */
export function rateBandForStage(
  platform: ProfilePlatform,
  stage: AccountStage,
  family: RateFamily = "general",
): { min: number; max: number; target: number; family: RateFamily; label: string } {
  return rateBandForNicheStage(platform, stage, family)
}

/** Build a short offer sentence from Settings skill tags (proposals / generator). */
export function buildSkillsFromTags(tags: string[]): string {
  if (tags.length === 0) return ""
  if (tags.length === 1) {
    return `I deliver ${tags[0]} — production-ready work tailored to the brief.`
  }
  const head = tags.slice(0, -1).join(", ")
  const last = tags[tags.length - 1]
  return `I deliver ${head}, and ${last} — production-ready work tailored to the brief.`
}
