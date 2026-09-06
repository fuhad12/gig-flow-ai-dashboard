/**
 * Side-by-side gig comparison engine.
 *
 * Workflow:
 *   1. For each input URL: try the cache first, fall back to scrape+analyze.
 *      This both saves money and keeps the path consistent with /api/analyze.
 *   2. Once we have N {scraped, analysis} tuples, ask the LLM to produce a
 *      competitive narrative — per-gig wins/losses + an overall verdict +
 *      one actionable recommendation aimed at the FIRST gig (the user's).
 *
 * Costs: ~3 standalone analyze calls + 1 short narrative call. The route
 * layer is responsible for premium gating and quota accounting (each
 * non-cached analyze burns one AI credit).
 */

import { z } from "zod"

import { analyzeGigWithLLM } from "@/lib/llm/analyze-gig"
import { getLlmProvider } from "@/lib/llm/provider"
import { getCachedAnalysis, storeAnalysis } from "@/lib/cache"
import { chargeCredit } from "@/lib/quota"
import { scrapeFiverrGig } from "@/lib/scraper"
import type {
  ComparisonGig,
  ComparisonNarrative,
  ComparisonReport,
} from "@/lib/compare-types"

// ---------- LLM schema for the narrative ----------

const NarrativeSchema = z.object({
  index: z.number().int().min(0),
  wins: z.array(z.string().max(160)).max(4),
  losses: z.array(z.string().max(160)).max(4),
  summary: z.string().max(280),
})

const ComparisonNarrativeSchema = z.object({
  verdict: z.string().max(360),
  topRecommendation: z.string().max(280),
  narratives: z.array(NarrativeSchema).min(2).max(3),
})

const narrativeJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string" },
    topRecommendation: { type: "string" },
    narratives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer", minimum: 0 },
          wins: { type: "array", items: { type: "string" } },
          losses: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["index", "wins", "losses", "summary"],
      },
    },
  },
  required: ["verdict", "topRecommendation", "narratives"],
} as const

// ---------- Per-URL prep ----------

/**
 * Get (scraped, analysis) for a URL, preferring cache. Returns whether
 * it came from cache so the caller can attribute quota correctly.
 *
 * `userId` is required when we fall through to storeAnalysis so the row
 * shows up in the user's history.
 */
async function loadOrAnalyze(
  url: string,
  userId: string,
): Promise<ComparisonGig> {
  // Cache hit?
  const cached = await getCachedAnalysis(url)
  if (cached) {
    // Still write a history row so the user can revisit it (matches the
    // /api/analyze cache-hit path).
    await storeAnalysis(url, userId, cached.scraped, cached.analysis)
    // Bill one credit per analyzed URL — quota was pre-checked by
    // /api/compare to confirm the user has enough room for all of them.
    await chargeCredit(userId)
    return {
      url,
      scraped: cached.scraped,
      analysis: cached.analysis,
      cached: true,
    }
  }
  // Cache miss → full scrape + analyze.
  const scraped = await scrapeFiverrGig(url)
  const analysis = await analyzeGigWithLLM(scraped)
  await storeAnalysis(url, userId, scraped, analysis)
  await chargeCredit(userId)
  return { url, scraped, analysis, cached: false }
}

// ---------- LLM narrative pass ----------

function gigDigest(gig: ComparisonGig, index: number): string {
  const { scraped, analysis } = gig
  const tagStr = scraped.tags.join(", ")
  const pkg = scraped.packages
    .map((p) => `${p.name}=$${p.price}`)
    .join(" · ")
  return [
    `Gig #${index}${index === 0 ? " (the user's own)" : " (competitor)"}:`,
    `  URL: ${scraped.sourceUrl}`,
    `  Title: ${scraped.title}`,
    `  Tags: ${tagStr || "(none)"}`,
    `  Packages: ${pkg || "(none)"}`,
    `  Optimization score: ${Math.round(analysis.optimizationScore)}/100`,
    `  Ranking potential: ${analysis.rankingPotential}`,
    `  Clickability: ${Math.round(analysis.clickabilityPercentage)}%`,
    `  Buyer trust: ${Math.round(analysis.buyerTrustScore)}%`,
  ].join("\n")
}

async function generateNarrative(
  gigs: ComparisonGig[],
): Promise<{
  verdict: string
  topRecommendation: string
  narratives: ComparisonNarrative[]
}> {
  // Skip the LLM pass entirely if no provider is configured — the
  // deterministic fallback still produces a usable side-by-side report.
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return fallbackNarrative(gigs)
  }
  const provider = getLlmProvider()

  const userPrompt = [
    `Compare ${gigs.length} Fiverr gigs side-by-side. Gig #0 is the user's own; the rest are competitors.`,
    "",
    gigs.map((g, i) => gigDigest(g, i)).join("\n\n"),
    "",
    "Produce:",
    "- verdict: 1-2 sentences naming the strongest overall gig and why.",
    "- topRecommendation: ONE concrete move the user (gig #0) should make to close the gap.",
    "- narratives: one entry per gig with",
    "    - wins: 1-3 short bullets where this gig beats the others (e.g. 'Best buyer-trust score').",
    "    - losses: 1-3 short bullets where this gig loses ground.",
    "    - summary: 1-sentence verdict on this specific gig.",
    "",
    "Cite real numbers/keywords from the data. Be specific.",
  ].join("\n")

  let raw: string
  try {
    raw = await provider.completeStructured({
      model: "smart",
      temperature: 0.45,
      messages: [
        {
          role: "system",
          content:
            "You are JobFlow AI's competitive intelligence analyst. Return strictly valid JSON matching the schema. Never invent figures the user didn't supply.",
        },
        { role: "user", content: userPrompt },
      ],
      schema: narrativeJsonSchema,
      schemaName: "ComparisonNarrative",
      // 2-3 gigs × short bullet lists. Comfortably under 1.5k tokens.
      maxOutputTokens: 2048,
    })
  } catch {
    return fallbackNarrative(gigs)
  }
  if (!raw) return fallbackNarrative(gigs)
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return fallbackNarrative(gigs)
  }
  const parsed = ComparisonNarrativeSchema.safeParse(json)
  if (!parsed.success) return fallbackNarrative(gigs)
  // Clamp indices into [0, gigs.length).
  const narratives = parsed.data.narratives
    .filter((n) => n.index >= 0 && n.index < gigs.length)
    .map((n) => ({
      index: n.index,
      wins: n.wins,
      losses: n.losses,
      summary: n.summary,
    }))
  return {
    verdict: parsed.data.verdict,
    topRecommendation: parsed.data.topRecommendation,
    narratives,
  }
}

/**
 * Deterministic non-LLM fallback. Picks wins/losses based purely on
 * which gig has the best score per metric. Keeps the feature usable when
 * the LLM is unavailable.
 */
function fallbackNarrative(gigs: ComparisonGig[]): {
  verdict: string
  topRecommendation: string
  narratives: ComparisonNarrative[]
} {
  const scores = gigs.map((g) => g.analysis.optimizationScore)
  const best = scores.indexOf(Math.max(...scores))

  const narratives: ComparisonNarrative[] = gigs.map((g, i) => {
    const wins: string[] = []
    const losses: string[] = []
    if (i === best)
      wins.push(`Highest overall optimization score (${Math.round(scores[i])}/100)`)
    else losses.push(`Trails the leader by ${Math.round(scores[best] - scores[i])} points`)
    return {
      index: i,
      wins,
      losses,
      summary:
        i === best
          ? "Strongest of the bunch on the headline score."
          : "Has room to grow vs the top of this set.",
    }
  })

  return {
    verdict:
      best === 0
        ? "Your gig already has the highest optimization score of this set — keep widening the gap."
        : `Competitor #${best} is currently the strongest on optimization score; this comparison surfaces what they're doing better.`,
    topRecommendation:
      "Pull the optimized title + description from the strongest gig and use them as a starting point for your rewrite.",
    narratives,
  }
}

// ---------- Public entry point ----------

/**
 * Run the full comparison flow for a list of URLs.
 *
 * Returns a ComparisonReport. Throws on hard failures (scrape/analyze
 * errors propagate so the route layer can map them to 502).
 */
export async function compareGigs(
  userId: string,
  urls: string[],
): Promise<ComparisonReport> {
  // Run scrape+analyze in parallel — these are network-bound and the
  // upstream rate limit is per-URL, not per-call. Three at once is fine.
  const gigs = await Promise.all(urls.map((u) => loadOrAnalyze(u, userId)))
  const narrative = await generateNarrative(gigs)
  return {
    gigs,
    narratives: narrative.narratives,
    verdict: narrative.verdict,
    topRecommendation: narrative.topRecommendation,
  }
}

/** Count how many of the prepared gigs required a fresh analyze. */
export function freshAnalyzeCount(report: ComparisonReport): number {
  return report.gigs.filter((g) => !g.cached).length
}
