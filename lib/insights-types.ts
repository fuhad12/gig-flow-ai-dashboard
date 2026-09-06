/**
 * AI-generated niche insights, derived from a `NicheSnapshot`.
 *
 * Stored in the `niche_insights` table keyed by (niche_slug, scraped_at) so
 * the same snapshot never gets re-analyzed.
 */

export type InsightType = "opportunity" | "warning" | "trend" | "pricing"

export interface NicheInsight {
  type: InsightType
  title: string
  body: string
}

export interface NicheInsights {
  headline: string
  insights: NicheInsight[]
  competitorAngle: string
  recommendedAction: string
}

export interface InsightsResponse {
  insights: NicheInsights
  /** Whether the result was served from cache. */
  cached: boolean
  /** Snapshot scraped_at this insight is bound to. */
  scrapedAt: string | null
}
