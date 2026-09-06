/**
 * Conversion prediction LLM step. Takes an already-analyzed gig and returns
 * a structured `ConversionPrediction` (realistic monthly funnel + improvement
 * levers + competition framing).
 */

import { z } from "zod"

import { getAllCachedSnapshots } from "@/lib/trends"
import { renderTrendsContext } from "@/lib/openai"
import { getLlmProvider } from "@/lib/llm/provider"
import { callWithTruncationRetry, safeJsonParse } from "@/lib/llm/truncation"
import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"
import type { ConversionPrediction } from "@/lib/prediction-types"

// ---------- Zod schema ----------

const RangeSchema = z.object({
  low: z.number().min(0),
  mid: z.number().min(0),
  high: z.number().min(0),
})

const KeyFactorSchema = z.object({
  factor: z.string().min(1).max(80),
  direction: z.enum(["positive", "negative", "neutral"]),
  weight: z.enum(["Low", "Medium", "High"]),
  note: z.string().min(1).max(220),
})

const ImprovementLeverSchema = z.object({
  lever: z.string().min(1).max(120),
  impact: z.enum(["Low", "Medium", "High"]),
  projectedLift: z.string().min(1).max(160),
})

export const PredictionSchema = z.object({
  predictedImpressions: RangeSchema,
  predictedClicks: RangeSchema,
  predictedOrders: RangeSchema,
  ctrPercent: z.number().min(0).max(100),
  conversionRatePercent: z.number().min(0).max(100),
  confidenceLevel: z.enum(["Low", "Medium", "High"]),
  competitionDifficulty: z.enum(["Low", "Medium", "High", "Saturated"]),
  nicheFitScore: z.number().min(0).max(100),
  keyFactors: z.array(KeyFactorSchema).min(3).max(8),
  improvementLevers: z.array(ImprovementLeverSchema).min(3).max(6),
  summary: z.string().min(40),
})

// ---------- JSON schema (OpenAI strict structured outputs) ----------

const rangeJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    low: { type: "number", minimum: 0 },
    mid: { type: "number", minimum: 0 },
    high: { type: "number", minimum: 0 },
  },
  required: ["low", "mid", "high"],
} as const

const keyFactorJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    factor: { type: "string" },
    direction: { type: "string", enum: ["positive", "negative", "neutral"] },
    weight: { type: "string", enum: ["Low", "Medium", "High"] },
    note: { type: "string" },
  },
  required: ["factor", "direction", "weight", "note"],
} as const

const improvementLeverJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    lever: { type: "string" },
    impact: { type: "string", enum: ["Low", "Medium", "High"] },
    projectedLift: { type: "string" },
  },
  required: ["lever", "impact", "projectedLift"],
} as const

const predictionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    predictedImpressions: rangeJson,
    predictedClicks: rangeJson,
    predictedOrders: rangeJson,
    ctrPercent: { type: "number", minimum: 0, maximum: 100 },
    conversionRatePercent: { type: "number", minimum: 0, maximum: 100 },
    confidenceLevel: { type: "string", enum: ["Low", "Medium", "High"] },
    competitionDifficulty: {
      type: "string",
      enum: ["Low", "Medium", "High", "Saturated"],
    },
    nicheFitScore: { type: "number", minimum: 0, maximum: 100 },
    keyFactors: { type: "array", items: keyFactorJson },
    improvementLevers: { type: "array", items: improvementLeverJson },
    summary: { type: "string" },
  },
  required: [
    "predictedImpressions",
    "predictedClicks",
    "predictedOrders",
    "ctrPercent",
    "conversionRatePercent",
    "confidenceLevel",
    "competitionDifficulty",
    "nicheFitScore",
    "keyFactors",
    "improvementLevers",
    "summary",
  ],
} as const

/**
 * Run the conversion prediction. Throws on LLM / schema failures.
 */
export async function predictConversionWithLLM(
  scraped: ScrapedGig,
  analysis: GigAnalysis,
): Promise<ConversionPrediction> {
  const provider = getLlmProvider()
  const trends = await getAllCachedSnapshots().catch(() => [])

  const systemPrompt = [
    "You are JobFlow AI's conversion analyst.",
    "Given a scraped Fiverr gig, its audit scores, and current niche trends, you predict realistic monthly funnel performance.",
    "Return strictly valid JSON matching the schema.",
    "",
    "Calibration (be honest — most new gigs are slow):",
    "- Saturated niche, low optimization (analysis < 50): 50-500 impressions/mo, ~1-2% CTR, ~1-2% conversion.",
    "- Medium optimization (50-70): 500-3,000 impressions/mo, ~2-4% CTR, ~2-4% conversion.",
    "- Strong optimization (70-85): 3,000-12,000 impressions/mo, ~4-7% CTR, ~3-6% conversion.",
    "- Hero gigs (>85): 12,000+ impressions/mo, ~6-10% CTR, ~4-8% conversion.",
    "Adjust *down* if competition is Saturated. Adjust *up* if the niche is hot and the gig stack matches trending keywords.",
    "",
    "Math invariant: predictedClicks.mid ≈ predictedImpressions.mid × (ctrPercent/100).",
    "            predictedOrders.mid ≈ predictedClicks.mid × (conversionRatePercent/100).",
    "Keep low/mid/high ranges internally consistent (low < mid < high). Round to whole numbers.",
    "",
    "Scoring rules:",
    "- nicheFitScore (0-100): how well the gig's positioning matches current buyer demand. Reference trend keywords if available.",
    "- competitionDifficulty: Low/Medium/High/Saturated based on number of competing gigs and pricing race-to-bottom signals.",
    "- confidenceLevel: Low if the snapshot is small or noisy; High if data is rich and gig signals are clear.",
    "",
    "keyFactors (3-6 items): mix of positive AND negative drivers. Each references concrete elements ('title uses generic word \"website\"', 'no thumbnail', 'price 40% below niche median').",
    "improvementLevers (3-5 items): concrete, prioritized by impact. projectedLift should be a quantified statement like '+30-50% CTR' or 'orders ~2x within 60 days'.",
    "summary: 2-3 sentence verdict in the seller's voice.",
  ].join("\n")

  const userPrompt = [
    "Predict realistic monthly conversion for this gig:",
    "",
    `URL: ${scraped.sourceUrl}`,
    `Title: ${scraped.title}`,
    `Tags: ${scraped.tags.join(", ")}`,
    `Packages: ${scraped.packages
      .map((p) => `${p.name} $${p.price}`)
      .join(" | ")}`,
    `Thumbnail present: ${scraped.thumbnailUrl ? "yes" : "no"}`,
    "",
    "Description (truncated):",
    scraped.description.slice(0, 800),
    "",
    "JobFlow audit scores:",
    `- optimizationScore: ${analysis.optimizationScore}`,
    `- rankingPotential: ${analysis.rankingPotential}`,
    `- clickabilityPercentage: ${analysis.clickabilityPercentage}`,
    `- buyerTrustScore: ${analysis.buyerTrustScore}`,
    analysis.thumbnail
      ? `- thumbnail.overallScore: ${analysis.thumbnail.overallScore} (ctrPotential: ${analysis.thumbnail.ctrPotential})`
      : "- thumbnail.overallScore: n/a (no thumbnail)",
    "",
    "Top SEO critiques the auditor surfaced:",
    ...analysis.seoCritiques.slice(0, 5).map((c) => `- ${c}`),
    renderTrendsContext(trends),
  ].join("\n")

  const baseRequest = {
    model: "smart" as const,
    temperature: 0.5,
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ],
    schema: predictionJsonSchema,
    schemaName: "ConversionPrediction",
    // Prediction output (score + a few short reasoning lines + suggested
    // levers) is tight — under ~1k tokens in practice. 3072 leaves
    // headroom; the retry doubles to 6144 if the model overshoots.
    maxOutputTokens: 3072,
  }

  const raw = await callWithTruncationRetry(
    (maxOutputTokens) =>
      provider.completeStructured({ ...baseRequest, maxOutputTokens }),
    baseRequest.maxOutputTokens,
    "predict-conversion",
  )

  const parsed = PredictionSchema.safeParse(safeJsonParse(raw))
  if (!parsed.success) {
    throw new Error(
      `Prediction schema mismatch: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    )
  }
  return parsed.data
}
