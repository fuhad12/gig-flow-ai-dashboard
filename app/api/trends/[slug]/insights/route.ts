import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { getLlmProvider } from "@/lib/llm/provider"
import { getQuotaStatus } from "@/lib/quota"
import { getNicheSnapshot, type NicheSnapshot } from "@/lib/trends"
import { getNiche, NICHES } from "@/lib/niches"
import type { NicheInsights } from "@/lib/insights-types"

export const runtime = "nodejs"
export const maxDuration = 60

const INSIGHTS_TABLE = "niche_insights"

// ---------- LLM schema ----------

// Per-field char ceilings. The schema is lenient — anything that overshoots
// is soft-truncated post-parse via `softCapInsights` below so a slightly
// over-eager LLM response can still reach the user instead of 502'ing.
const MAX_HEADLINE = 280
const MAX_TITLE = 100
const MAX_BODY = 360
const MAX_COMPETITOR_ANGLE = 600
const MAX_RECOMMENDED_ACTION = 600

const InsightSchema = z.object({
  type: z.enum(["opportunity", "warning", "trend", "pricing"]),
  title: z.string().min(1),
  body: z.string().min(1),
})

const NicheInsightsSchema = z.object({
  headline: z.string().min(10),
  insights: z.array(InsightSchema).min(3).max(6),
  competitorAngle: z.string().min(20),
  recommendedAction: z.string().min(20),
})

// Clip a free-text field at a soft boundary (word break if possible). Used
// to enforce display lengths without rejecting the whole LLM response.
function softCap(value: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  const slice = trimmed.slice(0, max)
  const lastSpace = slice.lastIndexOf(" ")
  const cut = lastSpace > max * 0.7 ? slice.slice(0, lastSpace) : slice
  return cut.replace(/[\s,.;:!?-]+$/u, "") + "…"
}

function softCapInsights(raw: NicheInsights): NicheInsights {
  return {
    headline: softCap(raw.headline, MAX_HEADLINE),
    insights: raw.insights.map((i) => ({
      type: i.type,
      title: softCap(i.title, MAX_TITLE),
      body: softCap(i.body, MAX_BODY),
    })),
    competitorAngle: softCap(raw.competitorAngle, MAX_COMPETITOR_ANGLE),
    recommendedAction: softCap(raw.recommendedAction, MAX_RECOMMENDED_ACTION),
  }
}

const insightJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["opportunity", "warning", "trend", "pricing"] },
    title: { type: "string" },
    body: { type: "string" },
  },
  required: ["type", "title", "body"],
} as const

const nicheInsightsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    insights: { type: "array", items: insightJsonSchema },
    competitorAngle: { type: "string" },
    recommendedAction: { type: "string" },
  },
  required: ["headline", "insights", "competitorAngle", "recommendedAction"],
} as const

// ---------- Helpers ----------

function snapshotDigest(snapshot: NicheSnapshot): string {
  const topKw = snapshot.keywords
    .slice(0, 18)
    .map((k) => `${k.keyword} (${k.count})`)
    .join(", ")
  const titles = snapshot.gigs
    .slice(0, 10)
    .map((g) => `- ${g.title} | $${g.price ?? "?"} | ${g.rating ?? "?"}★ (${g.reviewCount ?? 0}) | ${g.sellerLevel ?? "?"}`)
    .join("\n")
  const ps = snapshot.priceStats
  return [
    `Niche: ${snapshot.name}`,
    `Sample size: ${snapshot.gigs.length} gigs`,
    `Price stats: min $${ps.min} · median $${ps.median} · avg $${ps.average} · max $${ps.max}`,
    `Top keywords (count): ${topKw}`,
    `Top gigs:`,
    titles,
  ].join("\n")
}

async function readCachedInsights(
  slug: string,
  scrapedAt: string,
): Promise<NicheInsights | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null
  const { data, error } = await admin
    .from(INSIGHTS_TABLE)
    .select("insights")
    .eq("niche_slug", slug)
    .eq("scraped_at", scrapedAt)
    .maybeSingle()
  if (error || !data) return null
  return data.insights as NicheInsights
}

async function writeCachedInsights(
  slug: string,
  scrapedAt: string,
  insights: NicheInsights,
): Promise<void> {
  const admin = getSupabaseAdmin()
  if (!admin) return
  // Upsert in case two requests race on the same snapshot.
  const { error } = await admin
    .from(INSIGHTS_TABLE)
    .upsert(
      { niche_slug: slug, scraped_at: scrapedAt, insights },
      { onConflict: "niche_slug,scraped_at" },
    )
  if (error) {
    console.error("[insights] upsert failed:", error.message)
  }
}

// ---------- Route ----------

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params

  if (!getNiche(slug)) {
    return NextResponse.json(
      {
        error: `Unknown niche: ${slug}`,
        available: NICHES.map((n) => n.slug),
      },
      { status: 404 },
    )
  }

  // Auth-gate.
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
      { error: "You must be signed in to view insights" },
      { status: 401 },
    )
  }

  const url = new URL(req.url)
  const regenerate = url.searchParams.get("regenerate") === "true"

  // Credit gate for LLM. Snapshot is always readOnly — Firecrawl/Apify
  // scrapes are metered on the main trends Load/Refresh path only.
  const quota = await getQuotaStatus(user.id)
  const canSpend = quota.allowed

  let snapshot: NicheSnapshot
  try {
    ;({ snapshot } = await getNicheSnapshot(slug, { readOnly: true }))
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

  // 2. Cache lookup.
  if (!regenerate) {
    const cached = await readCachedInsights(slug, snapshot.scrapedAt)
    if (cached) {
      return NextResponse.json(
        { insights: cached, cached: true, scrapedAt: snapshot.scrapedAt },
        { status: 200 },
      )
    }
  }

  // 2b. Cache miss OR regenerate: we're about to spend an LLM call.
  // Refuse if the user is out of monthly credits.
  if (!canSpend) {
    return NextResponse.json(
      {
        error: quota.isPremium
          ? "You've used all your monthly AI credits. Buy a credit top-up to generate fresh niche insights."
          : "Free plan limit reached. Upgrade to Pro to generate fresh niche insights.",
        quota,
      },
      { status: 402 },
    )
  }

  // 3. Generate fresh insights.
  // Provider readiness (OPENAI_API_KEY or GEMINI_API_KEY) is enforced inside
  // the provider — it throws here if nothing is configured.
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "No LLM provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY + LLM_PROVIDER on the server.",
      },
      { status: 500 },
    )
  }

  const systemPrompt = [
    "You are JobFlow AI's market-intelligence analyst for Fiverr.",
    "You read a competitor scrape of a niche and surface what a seller MUST know.",
    "Return strictly valid JSON matching the schema.",
    "",
    "Guidance:",
    `- headline: one punchy 1-sentence summary of THIS niche's current state. Keep it under ${MAX_HEADLINE} characters — a single sentence, not a paragraph.`,
    "- insights: 3-5 specific, evidence-based observations. Reference real numbers / keywords from the data below.",
    "  Distribute across these types based on what the data shows:",
    "  - opportunity: an underserved angle, gap in pricing, missing trust signal.",
    "  - warning: oversaturation, race-to-the-bottom pricing, declining differentiation.",
    "  - trend: rising keywords/tools/styles that appear in the scraped data — let the actual top-keywords list drive this (whether that's 'Premiere Pro', 'minimalist', 'TikTok reels', 'Next.js', 'Klaviyo', etc.). Never insert tool names that are not in the scraped data.",
    "  - pricing: what tier the median lives at, where the premium ceiling is.",
    "- competitorAngle: 1-2 sentences on what top sellers in THIS niche are doing that newer sellers miss.",
    "- recommendedAction: ONE concrete next move appropriate to the niche (e.g. 'launch a $75 starter tier branded as ...').",
    "",
    "Never invent data. If the snapshot is small, say so and be conservative.",
    "Never default to AI/dev jargon unless the niche is genuinely an AI/dev niche.",
  ].join("\n")

  const userPrompt = [
    "Analyze this niche snapshot and produce structured insights:",
    "",
    snapshotDigest(snapshot),
  ].join("\n")

  const provider = getLlmProvider()
  let raw: string
  try {
    raw = await provider.completeStructured({
      model: "smart",
      temperature: 0.55,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      schema: nicheInsightsJsonSchema,
      schemaName: "NicheInsights",
      // Niche insights are 4-6 short bullets each across a handful of
      // sections — comfortably under 1.5k tokens.
      maxOutputTokens: 2048,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Insights generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }

  if (!raw) {
    return NextResponse.json(
      { error: "LLM returned an empty response" },
      { status: 502 },
    )
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { error: "LLM returned invalid JSON" },
      { status: 502 },
    )
  }
  const validated = NicheInsightsSchema.safeParse(json)
  if (!validated.success) {
    return NextResponse.json(
      { error: `Insights schema mismatch: ${validated.error.issues[0]?.message ?? "unknown"}` },
      { status: 502 },
    )
  }

  // Display-side truncation: enforce per-field max lengths via soft-cap
  // rather than rejecting the response. The LLM occasionally writes a
  // 175-char headline despite the prompt — UX should not pay for that.
  const insights: NicheInsights = softCapInsights(validated.data)
  // 4. Cache for next reload.
  await writeCachedInsights(slug, snapshot.scrapedAt, insights)

  return NextResponse.json(
    { insights, cached: false, scrapedAt: snapshot.scrapedAt },
    { status: 200 },
  )
}
