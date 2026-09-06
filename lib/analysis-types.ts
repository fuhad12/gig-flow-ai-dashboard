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
