/**
 * Shared OpenAI helpers used by multiple route handlers.
 *
 * Centralized so /api/analyze, /api/predict, /api/generate and the trends
 * insights route all build their clients and trends context the same way.
 */

import OpenAI from "openai"
import type { NicheSnapshot } from "@/lib/trends"

/**
 * Lazy OpenAI client. Throws (rather than returning a broken client) if the
 * key is missing so calling code can map the error to a 500 response.
 */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server")
  }
  return new OpenAI({ apiKey })
}

/**
 * Render the cached niche snapshots as a compact text block the LLM can use
 * as competitor / market context. Empty string if we have nothing cached.
 */
export function renderTrendsContext(snapshots: NicheSnapshot[]): string {
  if (snapshots.length === 0) return ""
  const sections = snapshots.map((s) => {
    const topKeywords = s.keywords
      .slice(0, 12)
      .map((k) => `${k.keyword}×${k.count}`)
      .join(", ")
    const price = s.priceStats
    const priceLine =
      price.median != null
        ? `median $${price.median}, range $${price.min}–$${price.max}`
        : "no price data"
    return `${s.name} (${s.gigs.length} top gigs): keywords [${topKeywords}]; pricing ${priceLine}.`
  })
  return [
    "",
    "Competitor intelligence from currently top-ranking Fiverr gigs:",
    ...sections.map((s) => `- ${s}`),
    "Use this to ground your reasoning in real market data.",
  ].join("\n")
}
