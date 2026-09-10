/**
 * Core LLM analysis pipeline for a scraped Fiverr gig.
 *
 * Extracted from /api/analyze so both /api/analyze and /api/predict can call
 * the same canonical implementation. Returns a validated `GigAnalysis`.
 */

import { z } from "zod"

import { getAllCachedSnapshots } from "@/lib/trends"
import { renderTrendsContext } from "@/lib/openai"
import {
  FIVERR_WINNING_RULES,
  FREELANCER_VISIBILITY_RULES,
} from "@/lib/llm/conversion-playbook"
import { getLlmProvider } from "@/lib/llm/provider"
import { callWithTruncationRetry, safeJsonParse } from "@/lib/llm/truncation"
import { FIVERR, softTruncate, finalizeGigDescription } from "@/lib/fiverr-limits"
import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"
import {
  DEFAULT_GIG_CHECKLIST,
  cleanChecklist,
  cleanProofQuotes,
  cleanQaPairs,
} from "@/lib/visibility-types"

// ---------- Zod schemas ----------

const ThumbnailAnalysisSchema = z.object({
  overallScore: z.number().min(0).max(100),
  contrastScore: z.number().min(0).max(100),
  readabilityScore: z.number().min(0).max(100),
  ctrPotential: z.enum(["Low", "Medium", "High"]),
  critiques: z.array(z.string()).min(1),
  improvedConcept: z.string().min(1),
})

const VisibilityItemSchema = z.object({
  id: z.string().min(2).max(48),
  layer: z.enum(["seo", "aeo", "geo", "aio"]),
  title: z.string().min(4).max(100),
  detail: z.string().min(12).max(320),
})

const FaqSchema = z.object({
  question: z.string().min(8).max(200),
  answer: z.string().min(12).max(600),
})

export const AnalysisSchema = z.object({
  optimizationScore: z.number().min(0).max(100),
  rankingPotential: z.enum(["Low", "Medium", "High"]),
  clickabilityPercentage: z.number().min(0).max(100),
  buyerTrustScore: z.number().min(0).max(100),
  roastComments: z.array(z.string()).min(1),
  seoCritiques: z.array(z.string()).min(1),
  optimizedTitle: z.string().min(1).max(FIVERR.title.max),
  optimizedDescription: z.string().min(1).max(FIVERR.description.max),
  optimizedTags: z
    .array(z.string().max(FIVERR.tag.max))
    .length(FIVERR.tag.count),
  thumbnail: ThumbnailAnalysisSchema.nullable(),
  answerReadinessScore: z.number().min(0).max(100).default(50),
  answerReadinessNotes: z.array(z.string()).default([]),
  suggestedFaqs: z.array(FaqSchema).default([]),
  geoCiteScore: z.number().min(0).max(100).default(50),
  proofQuotes: z.array(z.string()).default([]),
  visibilityChecklist: z.array(VisibilityItemSchema).default([]),
})

// ---------- OpenAI strict structured-output JSON Schema mirror ----------

const thumbnailJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overallScore: { type: "number", minimum: 0, maximum: 100 },
    contrastScore: { type: "number", minimum: 0, maximum: 100 },
    readabilityScore: { type: "number", minimum: 0, maximum: 100 },
    ctrPotential: { type: "string", enum: ["Low", "Medium", "High"] },
    critiques: { type: "array", items: { type: "string" } },
    improvedConcept: { type: "string" },
  },
  required: [
    "overallScore",
    "contrastScore",
    "readabilityScore",
    "ctrPotential",
    "critiques",
    "improvedConcept",
  ],
} as const

const visibilityItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    layer: { type: "string", enum: ["seo", "aeo", "geo", "aio"] },
    title: { type: "string" },
    detail: { type: "string" },
  },
  required: ["id", "layer", "title", "detail"],
} as const

const faqJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    question: { type: "string" },
    answer: { type: "string" },
  },
  required: ["question", "answer"],
} as const

const analysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    optimizationScore: { type: "number", minimum: 0, maximum: 100 },
    rankingPotential: { type: "string", enum: ["Low", "Medium", "High"] },
    clickabilityPercentage: { type: "number", minimum: 0, maximum: 100 },
    buyerTrustScore: { type: "number", minimum: 0, maximum: 100 },
    roastComments: { type: "array", items: { type: "string" } },
    seoCritiques: { type: "array", items: { type: "string" } },
    // NOTE: OpenAI strict structured outputs don't support maxLength /
    // minItems / maxItems. Limits are enforced via the system prompt,
    // post-parse softTruncate, and the Zod schema below.
    optimizedTitle: { type: "string" },
    optimizedDescription: { type: "string" },
    optimizedTags: { type: "array", items: { type: "string" } },
    thumbnail: {
      anyOf: [thumbnailJsonSchema, { type: "null" }],
    },
    answerReadinessScore: { type: "number", minimum: 0, maximum: 100 },
    answerReadinessNotes: { type: "array", items: { type: "string" } },
    suggestedFaqs: { type: "array", items: faqJsonSchema },
    geoCiteScore: { type: "number", minimum: 0, maximum: 100 },
    proofQuotes: { type: "array", items: { type: "string" } },
    visibilityChecklist: { type: "array", items: visibilityItemJsonSchema },
  },
  required: [
    "optimizationScore",
    "rankingPotential",
    "clickabilityPercentage",
    "buyerTrustScore",
    "roastComments",
    "seoCritiques",
    "optimizedTitle",
    "optimizedDescription",
    "optimizedTags",
    "thumbnail",
    "answerReadinessScore",
    "answerReadinessNotes",
    "suggestedFaqs",
    "geoCiteScore",
    "proofQuotes",
    "visibilityChecklist",
  ],
} as const

/**
 * Run the gig audit through the active LLM provider (multimodal if a
 * thumbnail URL is present). Throws on LLM failures / schema mismatches; the
 * caller maps to HTTP codes.
 */
export async function analyzeGigWithLLM(
  scraped: ScrapedGig,
): Promise<GigAnalysis> {
  const provider = getLlmProvider()

  // Best-effort: pull whatever cached niche trends we have. Never scrape from
  // this path — we don't want analyze calls implicitly triggering Firecrawl.
  const trends = await getAllCachedSnapshots().catch(() => [])

  const systemPrompt = [
    "You are JobFlow AI, a Fiverr SEO and conversion strategist whose job is more orders — not prettier copy.",
    "You audit gig listings and return strictly valid JSON matching the provided schema.",
    "",
    FIVERR_WINNING_RULES,
    "",
    FREELANCER_VISIBILITY_RULES,
    "",
    "Scoring guidance:",
    "- optimizationScore: overall health 0-100 (weight conversion blockers as heavily as keyword gaps).",
    "- rankingPotential: Low if the listing uses saturated generic keywords; High if it uses specific long-tail terms aligned with current demand.",
    "- clickabilityPercentage: estimated relative CTR vs category median.",
    "- buyerTrustScore: trust signals from description, FAQs, packages, social proof — punish vague 'I am passionate' copy.",
    "- answerReadinessScore (AEO) 0-100: first-sentence clarity + FAQ coverage of buyer objections (formats, revisions, rights, turnaround).",
    "- geoCiteScore (GEO) 0-100: niche specificity + citable proof a client-facing AI could recommend; low if vague 'I do everything'.",
    "- answerReadinessNotes: 2-3 short AEO gaps (one sentence each).",
    "- suggestedFaqs: 3 paste-ready Q&A pairs for THIS gig (answers ≤2 sentences).",
    "- proofQuotes: 1-2 short lines grounded in THIS listing — NEVER invent clients/metrics.",
    "- visibilityChecklist: 4-5 actions with layer seo|aeo|geo|aio (id, short title, one-sentence detail).",
    "Critiques must be specific, actionable, and reference real elements of the gig.",
    "Roast comments should be witty and brutally honest but never abusive.",
    "Optimized copy MUST follow the Fiverr winning structure above AND target the language/buyer intent of THIS gig's category (e.g. minimalist/vector/mascot for logo design; Premiere Pro/reels/short-form for video editing; SEO/long-form for content writing; Next.js/Supabase for web dev). Mirror what real buyers in this exact niche search for — never default to dev-stack jargon if the gig is not a dev gig.",
    "When competitor intelligence is provided below, prefer evidence-based critiques over generic ones — let the competitors' real titles and tags tell you which keywords matter.",
    "Pick ONE short primaryKeyword buyers would search for THIS gig. Then rewrite optimizedTitle / optimizedDescription / optimizedTags for both ranking AND conversion:",
    `  - optimizedTitle: include the primaryKeyword ${FIVERR.keyword.titleMin}-${FIVERR.keyword.titleMax} time(s), readable outcome title (not a keyword dump).`,
    `  - optimizedDescription: primaryKeyword exact-match ${FIVERR.keyword.descMin}-${FIVERR.keyword.descMax} times — hook (first sentence) + body + CTA. No stuffing.`,
    `  - optimizedTags: ${FIVERR.keyword.tagMin}-${FIVERR.keyword.tagMax} tags contain the primaryKeyword; remaining tags are different long-tail buyer queries.`,
    "  - Use semantic variants (synonyms) for topical coverage between exact matches.",
    "",
    "FIVERR FIELD CONSTRAINTS — you MUST obey every one:",
    `- optimizedTitle: max ${FIVERR.title.max} chars, target ${FIVERR.title.optimalMin}-${FIVERR.title.optimalMax} chars. Prefer action + deliverable + outcome. Never use these characters: & / | # @ % "`,
    `- optimizedDescription: max ${FIVERR.description.max} chars, target ${FIVERR.description.optimalMin}-${FIVERR.description.optimalMax} chars. Plain text only. Follow Hook → Credibility → Deliverables → Process → What I need → CTA.`,
    "  CRITICAL: Finish the FULL structure inside the char budget. Never end on a bare heading like 'WHAT I NEED FROM YOU:' with no body. If short on space, shorten earlier sections — always close with a one-line CTA.",
    `- optimizedTags: EXACTLY ${FIVERR.tag.count} tags, each max ${FIVERR.tag.max} chars, lowercase letters/numbers/spaces/hyphens only.`,
    "These are hard caps Fiverr will reject if exceeded. Aim for the optimal range, never above the cap.",
    "",
    "Thumbnail evaluation:",
    "- If an image is attached, evaluate the gig thumbnail and populate `thumbnail` with:",
    "  - overallScore (0-100): holistic CTR/clickability quality.",
    "  - contrastScore (0-100): foreground vs background separation, text legibility against backdrop.",
    "  - readabilityScore (0-100): clarity of any text/headline, hierarchy, font choice at small sizes.",
    "  - ctrPotential: Low/Medium/High likelihood of stopping the scroll in a saturated search grid.",
    "  - critiques: 3-5 specific, actionable issues you can see in the image (composition, color, faces, focal subject, brand polish).",
    "  - improvedConcept: 1-2 sentences describing a stronger thumbnail concept (subject, colors, headline) the seller could brief a designer with.",
    "- If no image is attached, set `thumbnail` to null. Do not invent observations.",
  ].join("\n")

  const userTextLines = [
    "Analyze the following Fiverr gig and produce the structured audit.",
    "",
    `Source URL: ${scraped.sourceUrl}`,
    "",
    "Title:",
    scraped.title,
    "",
    "Description:",
    scraped.description,
    "",
    `Tags: ${scraped.tags.join(", ")}`,
    "",
    "Packages:",
    ...scraped.packages.map(
      (p) => `- ${p.name} ($${p.price}): ${p.details}`,
    ),
    "",
    scraped.thumbnailUrl
      ? "Thumbnail: see the image attached to this message."
      : "Thumbnail: not available — set `thumbnail` to null in the response.",
    renderTrendsContext(trends),
  ]
  const userText = userTextLines.join("\n")

  const baseRequest = {
    model: "smart" as const,
    temperature: 0.55,
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userText },
    ],
    schema: analysisJsonSchema,
    schemaName: "GigAnalysis",
    // Full analysis + AEO/GEO fields lands around ~3–5k output tokens.
    // 8192 first try; truncation helper escalates toward 16k if needed.
    maxOutputTokens: 8192,
  }

  // Call the model with automatic retry on truncation / malformed JSON.
  // A single bad first response (model emitted a runaway string, etc.)
  // shouldn't kill the analysis when a fresh attempt with a bigger
  // budget reliably succeeds.
  const raw = await callWithTruncationRetry(
    async (maxOutputTokens) => {
      const reqWithBudget = { ...baseRequest, maxOutputTokens }
      return scraped.thumbnailUrl
        ? await provider.completeMultimodal({
            ...reqWithBudget,
            images: [{ url: scraped.thumbnailUrl, detail: "high" }],
          })
        : await provider.completeStructured(reqWithBudget)
    },
    baseRequest.maxOutputTokens,
    "analyze-gig",
  )

  // Smart-truncate the optimized fields BEFORE schema validation so the cap
  // is always enforced even if the model overshoots. Zod's `.max()` would
  // otherwise throw and we'd lose the rest of a perfectly good audit.
  const rawJson = safeJsonParse(raw)
  if (typeof rawJson.optimizedTitle === "string") {
    rawJson.optimizedTitle = softTruncate(
      rawJson.optimizedTitle,
      FIVERR.title.max,
    )
  }
  if (typeof rawJson.optimizedDescription === "string") {
    rawJson.optimizedDescription = finalizeGigDescription(
      rawJson.optimizedDescription,
      FIVERR.description.max,
    )
  }
  if (Array.isArray(rawJson.optimizedTags)) {
    rawJson.optimizedTags = (rawJson.optimizedTags as unknown[])
      .filter((t): t is string => typeof t === "string")
      .slice(0, FIVERR.tag.count)
      .map((t) => softTruncate(t.toLowerCase(), FIVERR.tag.max))
    // Pad to exact count if the model under-delivered, to satisfy the schema.
    while ((rawJson.optimizedTags as string[]).length < FIVERR.tag.count) {
      ;(rawJson.optimizedTags as string[]).push("custom service")
    }
  }

  const parsed = AnalysisSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(
      `OpenAI returned data that does not match the expected schema: ${parsed.error.message}`,
    )
  }

  const data = parsed.data
  return {
    ...data,
    answerReadinessScore: Math.round(data.answerReadinessScore),
    answerReadinessNotes: data.answerReadinessNotes
      .map((s) => s.trim())
      .filter((s) => s.length >= 8)
      .slice(0, 4),
    suggestedFaqs: cleanQaPairs(data.suggestedFaqs, 5),
    geoCiteScore: Math.round(data.geoCiteScore),
    proofQuotes: cleanProofQuotes(data.proofQuotes, 3),
    visibilityChecklist: cleanChecklist(
      data.visibilityChecklist,
      DEFAULT_GIG_CHECKLIST,
      4,
      7,
    ),
  }
}
