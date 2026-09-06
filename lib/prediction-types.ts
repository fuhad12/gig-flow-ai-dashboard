/**
 * Conversion Prediction Engine types.
 *
 * Built on top of `GigAnalysis` — the prediction layer takes the already
 * computed analysis scores and reasons about realistic monthly funnel
 * performance, competition difficulty, and concrete improvement levers.
 */

import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"

export type Confidence = "Low" | "Medium" | "High"
export type CompetitionDifficulty = "Low" | "Medium" | "High" | "Saturated"
export type LeverImpact = "Low" | "Medium" | "High"
export type FactorDirection = "positive" | "negative" | "neutral"

export interface PredictedRange {
  low: number
  mid: number
  high: number
}

export interface KeyFactor {
  factor: string
  direction: FactorDirection
  weight: LeverImpact
  note: string
}

export interface ImprovementLever {
  lever: string
  impact: LeverImpact
  projectedLift: string
}

export interface ConversionPrediction {
  /** Realistic monthly funnel projections for a fresh gig at this quality. */
  predictedImpressions: PredictedRange
  predictedClicks: PredictedRange
  predictedOrders: PredictedRange

  /** Estimated funnel rates (%). */
  ctrPercent: number
  conversionRatePercent: number

  confidenceLevel: Confidence
  competitionDifficulty: CompetitionDifficulty
  /** 0-100: how well the gig fits current buyer demand in its niche. */
  nicheFitScore: number

  keyFactors: KeyFactor[]
  improvementLevers: ImprovementLever[]
  summary: string
}

export interface PredictResponse {
  url: string
  scraped: ScrapedGig
  analysis: GigAnalysis
  prediction: ConversionPrediction
  /** Whether the underlying analysis came from cache (no fresh OpenAI call). */
  analysisCached: boolean
}
