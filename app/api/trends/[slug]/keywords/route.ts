/**
 * Niche keyword discovery API.
 *
 *   GET /api/trends/:slug/keywords
 *
 * Pulls the latest niche snapshot, runs the statistical n-gram extractor
 * (`lib/keyword-discovery`), then optionally asks the LLM to attach a
 * short intent label + ranking-difficulty estimate to the top candidates.
 *
 * The LLM call is cached per (slug, scrapedAt) in-process so a refresh
 * within the same Vercel function instance reuses results. We don't
 * persist the LLM enrichment because it's cheap relative to a fresh
 * scrape and we want it to follow the niche snapshot's freshness window.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getLlmProvider } from "@/lib/llm/provider"
import { getProfile, getQuotaStatus } from "@/lib/quota"
import { getNicheSnapshot } from "@/lib/trends"
import { getNiche, NICHES } from "@/lib/niches"
import {
  discoverKeywords,
  type KeywordCandidate,
} from "@/lib/keyword-discovery"

/**
 * Build a small, niche-appropriate set of example phrases for the
 * "transactional / informational / branded / tool" labels. Each niche has
 * different lingo — logo designers don't search for "next.js developer".
 */
function intentExamplesFor(niche: string): {
  transactional: string
  informational: string
  branded: string
  tool: string
} {
  const def = getNiche(niche)
  const transactional = def?.transactionalExample ?? `${def?.name?.toLowerCase() ?? niche} expert`

  // Per-niche tool / brand examples (cheap to maintain — extend as needed).
  const examplesByNiche: Record<
    string,
    { informational: string; branded: string; tool: string }
  > = {
    "logo-design": {
      informational: "what is a brand mark",
      branded: "procreate",
      tool: "adobe illustrator",
    },
    "video-editing": {
      informational: "how to edit youtube videos",
      branded: "capcut",
      tool: "premiere pro",
    },
    voiceover: {
      informational: "how voiceover royalties work",
      branded: "elevenlabs",
      tool: "audacity",
    },
    "content-writing": {
      informational: "what is seo content",
      branded: "grammarly",
      tool: "surfer seo",
    },
    copywriting: {
      informational: "what is direct response copy",
      branded: "klaviyo",
      tool: "convertkit",
    },
    translation: {
      informational: "what is certified translation",
      branded: "trados",
      tool: "memoq",
    },
    seo: {
      informational: "how google ranks pages",
      branded: "ahrefs",
      tool: "semrush",
    },
    "social-media": {
      informational: "how to grow on tiktok",
      branded: "buffer",
      tool: "canva",
    },
    "virtual-assistant": {
      informational: "what does a virtual assistant do",
      branded: "clickup",
      tool: "notion",
    },
    illustration: {
      informational: "what is character design",
      branded: "procreate",
      tool: "adobe fresco",
    },
    "ui-ux": {
      informational: "what is a design system",
      branded: "figma",
      tool: "framer",
    },
    "web-development": {
      informational: "what is nextjs",
      branded: "lovable",
      tool: "supabase",
    },
    "ai-apps": {
      informational: "what is rag",
      branded: "cursor ai",
      tool: "langchain",
    },
    "no-code": {
      informational: "what is a no-code mvp",
      branded: "bubble",
      tool: "webflow",
    },
    "mobile-apps": {
      informational: "what is react native",
      branded: "expo",
      tool: "firebase",
    },
    "data-science": {
      informational: "what is rag",
      branded: "tableau",
      tool: "pandas",
    },
  }
  const fallback = {
    informational: `what is ${def?.name?.toLowerCase() ?? niche}`,
    branded: "a brand name in this niche",
    tool: "a tool buyers want used",
  }
  const ex = examplesByNiche[niche] ?? fallback
  return { transactional, ...ex }
}

export const runtime = "nodejs"
export const maxDuration = 60

interface EnrichedKeyword extends KeywordCandidate {
  intent?: "transactional" | "informational" | "branded" | "tool" | null
  difficulty?: "low" | "medium" | "high" | null
  rationale?: string | null
}

// ---------- LLM enrichment ----------

const EnrichmentSchema = z.object({
  items: z.array(
    z.object({
      phrase: z.string(),
      intent: z
        .enum(["transactional", "informational", "branded", "tool"])
        .nullable(),
      difficulty: z.enum(["low", "medium", "high"]).nullable(),
      rationale: z.string().max(160).nullable(),
    }),
  ),
})

const enrichmentJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          phrase: { type: "string" },
          intent: {
            anyOf: [
              {
                type: "string",
                enum: ["transactional", "informational", "branded", "tool"],
              },
              { type: "null" },
            ],
          },
          difficulty: {
            anyOf: [
              { type: "string", enum: ["low", "medium", "high"] },
              { type: "null" },
            ],
          },
          rationale: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
        },
        required: ["phrase", "intent", "difficulty", "rationale"],
      },
    },
  },
  required: ["items"],
} as const

// In-process memo (per Vercel function instance). Safe because output is
// purely a function of (slug, scrapedAt, list of phrases).
const enrichmentCache = new Map<string, EnrichedKeyword[]>()

async function enrichWithLLM(
  niche: string,
  scrapedAt: string,
  base: KeywordCandidate[],
  /**
   * When false, skip the LLM call and return the bare statistical
   * candidates. Used to silently degrade the experience for users who
   * are out of monthly AI credits — the page still works, they just
   * don't get the AI-classified intent / difficulty labels.
   */
  canSpend: boolean,
): Promise<EnrichedKeyword[]> {
  const cacheKey = `${niche}::${scrapedAt}::${base.map((b) => b.phrase).join("|")}`
  const hit = enrichmentCache.get(cacheKey)
  if (hit) return hit

  // Best-effort: skip enrichment when there's no LLM budget OR no
  // provider key configured.
  if (!canSpend) return base.map((b) => ({ ...b }))
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return base.map((b) => ({ ...b }))
  }

  const top = base.filter((b) => b.tier !== "saturated").slice(0, 20)
  if (top.length === 0) {
    const out = base.map((b) => ({ ...b }))
    enrichmentCache.set(cacheKey, out)
    return out
  }

  const ex = intentExamplesFor(niche)
  const userPrompt = [
    `Niche: ${niche}`,
    "For each candidate keyword/phrase below, classify intent and ranking difficulty for THIS niche.",
    "",
    "intent options (examples shown are specific to this niche):",
    `- transactional: buyers ready to hire (e.g. '${ex.transactional}')`,
    `- informational: buyers researching (e.g. '${ex.informational}')`,
    `- branded: tied to a product/tool brand name (e.g. '${ex.branded}')`,
    `- tool: a specific tool/library/style the buyer wants used (e.g. '${ex.tool}')`,
    "",
    "difficulty options:",
    "- low: niche, less competitive on Fiverr",
    "- medium: common but still winnable",
    "- high: saturated, top sellers dominate",
    "",
    "rationale: one short sentence (max 160 chars) on WHY a Fiverr seller in this niche should target it.",
    "",
    "Candidates:",
    top.map((c) => `- ${c.phrase}`).join("\n"),
  ].join("\n")

  const provider = getLlmProvider()
  let raw: string
  try {
    raw = await provider.completeStructured({
      model: "fast",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are JobFlow AI's Fiverr SEO analyst. Return strictly valid JSON matching the schema. Never invent phrases that aren't in the input list.",
        },
        { role: "user", content: userPrompt },
      ],
      schema: enrichmentJsonSchema,
      schemaName: "KeywordEnrichment",
      // Enrichment can include 40+ candidates with short metadata each.
      // 3072 tokens is enough headroom for the full list without runaway.
      maxOutputTokens: 3072,
    })
  } catch {
    // LLM is best-effort — fall back to the bare candidates.
    const out = base.map((b) => ({ ...b }))
    enrichmentCache.set(cacheKey, out)
    return out
  }

  let parsed: ReturnType<typeof EnrichmentSchema.parse> | null = null
  try {
    parsed = EnrichmentSchema.parse(JSON.parse(raw))
  } catch {
    parsed = null
  }
  const byPhrase = new Map<string, EnrichedKeyword>()
  for (const c of base) byPhrase.set(c.phrase, { ...c })
  if (parsed) {
    for (const e of parsed.items) {
      const existing = byPhrase.get(e.phrase)
      if (!existing) continue
      existing.intent = e.intent
      existing.difficulty = e.difficulty
      existing.rationale = e.rationale
    }
  }
  const out = Array.from(byPhrase.values())
  enrichmentCache.set(cacheKey, out)
  return out
}

// ---------- Route ----------

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params

  if (!getNiche(slug)) {
    return NextResponse.json(
      { error: `Unknown niche: ${slug}`, available: NICHES.map((n) => n.slug) },
      { status: 404 },
    )
  }

  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured on the server" },
      { status: 500 },
    )
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in" },
      { status: 401 },
    )
  }

  // Credit + scope gate. When the user is either out of monthly AI
  // credits OR viewing a niche they haven't pinned, we (a) block any
  // Firecrawl auto-refresh on stale snapshots (readOnly) and (b) skip
  // the LLM enrichment. The page still works — users see the
  // statistical candidates without AI-classified intent / difficulty
  // labels — but we never burn Firecrawl / LLM on niches the user
  // hasn't asked for.
  const [quota, profile] = await Promise.all([
    getQuotaStatus(user.id),
    getProfile(user.id),
  ])
  const isPinned = profile.selectedNiches.includes(slug)
  const canSpend = quota.allowed && isPinned

  // Load the existing niche snapshot — doesn't re-scrape unless stale.
  let snapshot
  try {
    snapshot = await getNicheSnapshot(slug, { readOnly: !canSpend })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load snapshot" },
      { status: 502 },
    )
  }

  if (snapshot.gigs.length === 0 || !snapshot.scrapedAt) {
    return NextResponse.json(
      { error: "No snapshot data available for this niche yet" },
      { status: 404 },
    )
  }

  const discovery = discoverKeywords(snapshot.name, snapshot.gigs)
  const enriched = await enrichWithLLM(
    snapshot.name,
    snapshot.scrapedAt,
    discovery.candidates,
    canSpend,
  )

  return NextResponse.json(
    {
      niche: snapshot.name,
      slug: snapshot.slug,
      scrapedAt: snapshot.scrapedAt,
      sampleSize: discovery.sampleSize,
      topSize: discovery.topSize,
      candidates: enriched,
    },
    { status: 200 },
  )
}
