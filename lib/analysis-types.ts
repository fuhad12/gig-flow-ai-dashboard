export interface ScrapedGig {
  sourceUrl: string
  thumbnailUrl: string | null
  title: string
  description: string
  tags: string[]
  packages: { name: string; price: number; details: string }[]
}

/** One row from a Fiverr search/category SERP scrape. */
export interface ScrapedSearchGig {
  url: string
  title: string
  price: number | null
  rating: number | null
  reviewCount: number | null
  sellerLevel: string | null
  position: number
}

export interface ThumbnailAnalysis {
  overallScore: number
  contrastScore: number
  readabilityScore: number
  ctrPotential: "Low" | "Medium" | "High"
  critiques: string[]
  improvedConcept: string
}

import type {
  QaPair,
  VisibilityChecklistItem,
} from "@/lib/visibility-types"

export interface GigAnalysis {
  optimizationScore: number
  rankingPotential: "Low" | "Medium" | "High"
  clickabilityPercentage: number
  buyerTrustScore: number
  roastComments: string[]
  seoCritiques: string[]
  optimizedTitle: string
  optimizedDescription: string
  optimizedTags: string[]
  thumbnail: ThumbnailAnalysis | null
  /**
   * AEO: how ready the listing is to be extracted as a direct answer
   * (hook + FAQ clarity). Optional for older cached audits.
   */
  answerReadinessScore?: number
  /** Short AEO gaps / fixes. */
  answerReadinessNotes?: string[]
  /** Paste-ready FAQ suggestions that remove pre-order DMs. */
  suggestedFaqs?: QaPair[]
  /**
   * GEO: how citable / recommendable the gig is if a buyer asks an AI
   * for someone in this niche. Optional for older cached audits.
   */
  geoCiteScore?: number
  /** Short lines AI could quote (must be grounded in the gig — no fakes). */
  proofQuotes?: string[]
  /** Weekly SEO → AEO → GEO → AIO actions. */
  visibilityChecklist?: VisibilityChecklistItem[]
}

export interface AnalyzeResponse {
  /**
   * Persisted gig_analyses row id. Present whenever the analysis was saved
   * server-side (every authenticated analyze + every history item). Used
   * to drive the share/PDF flow — if absent, the share button is hidden.
   */
  id?: string
  url: string
  scraped: ScrapedGig
  analysis: GigAnalysis
  cached: boolean
  cachedAt?: string
  /**
   * If the row has been made public, the slug to address it under
   * `/audit/<slug>`. Lets the UI pre-fill the share modal in "ON" state
   * without an extra round-trip.
   */
  publicSlug?: string | null
}
