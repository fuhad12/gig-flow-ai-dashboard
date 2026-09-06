/**
 * Shared types for the Compare feature (premium, 2–3 gigs side-by-side).
 */

import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"

export interface ComparisonGig {
  url: string
  scraped: ScrapedGig
  analysis: GigAnalysis
  /** True when this result came from cache (didn't burn an LLM call). */
  cached: boolean
}

/** AI-written competitive narrative — one entry per gig. */
export interface ComparisonNarrative {
  /** Which gig the narrative is about (0-based index in `gigs`). */
  index: number
  wins: string[]
  losses: string[]
  summary: string
}

export interface ComparisonReport {
  /** Position 0 is the user's own gig (first URL submitted). */
  gigs: ComparisonGig[]
  /** AI-written wins/losses/summary per gig. */
  narratives: ComparisonNarrative[]
  /** One-paragraph overall verdict the UI shows at the top. */
  verdict: string
  /**
   * Highest-leverage move the user should take (e.g. "Add a $75 starter
   * tier targeting the AI-app angle competitor #2 is dominating").
   */
  topRecommendation: string
}

export interface CompareRequest {
  /** 2–3 Fiverr gig URLs. Position 0 = the user's gig. */
  urls: string[]
}

export type CompareResponse =
  | ({ ok: true } & ComparisonReport)
  | { ok: false; error: string }
