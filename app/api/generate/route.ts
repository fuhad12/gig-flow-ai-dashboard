import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import {
  chargeCredit,
  getQuotaStatus,
  releaseReservation,
  reserveCreditSlot,
  updateReservation,
} from "@/lib/quota"
import { getAllCachedSnapshots, type NicheSnapshot } from "@/lib/trends"
import { getNicheDisplayName, renderTrendingTerms } from "@/lib/niches"
import { FIVERR, softTruncate } from "@/lib/fiverr-limits"
import {
  runWithFiverrValidation,
  type FiverrCheckable,
} from "@/lib/llm/with-fiverr-validation"
import { FIVERR_WINNING_RULES, FREELANCER_VISIBILITY_RULES } from "@/lib/llm/conversion-playbook"
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit"
import type { GigGeneration } from "@/lib/generation-types"

export const runtime = "nodejs"
export const maxDuration = 90

// IP-based throttle. Mirrors /api/analyze so attackers can't side-step
// the analyze limit by switching to generate. Override via env vars.
const GENERATE_RATE_LIMIT = parseInt(
  process.env.GENERATE_RATE_LIMIT_PER_HOUR ?? "10",
  10,
)
const GENERATE_RATE_WINDOW_MS = 60 * 60 * 1000

// ---------- Request validation ----------

const RequestSchema = z.object({
  niche: z.string().trim().min(1, "niche is required").max(100),
  skill: z
    .string()
    .trim()
    .min(3, "skill must be at least 3 characters")
    .max(300),
  tools: z
    .array(z.string().trim().min(1))
    .min(1, "at least one tool is required")
    .max(20),
  audience: z.string().trim().max(200).optional().default(""),
  experienceLevel: z
    .enum(["beginner", "intermediate", "expert"])
    .optional()
    .default("intermediate"),
})

// ---------- LLM response schema ----------
//
// Two schemas on purpose:
//   - GenerationShape: shape-only check, used inside the validator wrapper
//     so a too-long title doesn't blow up parsing before the retry flow gets
//     a chance to run. Field-length checks live in the violation collector.
//   - GenerationStrict: full strict check used after retry/truncate as a
//     last-line assertion that we never ship out-of-spec data.

const PackageShape = z.object({
  tier: z.enum(["Basic", "Standard", "Premium"]),
  name: z.string().min(1),
  description: z.string().min(1),
  price: z.number().min(5).max(10_000),
  deliveryDays: z
    .number()
    .int()
    .min(FIVERR.package.deliveryDays.min)
    .max(FIVERR.package.deliveryDays.max),
  revisions: z
    .number()
    .int()
    .min(FIVERR.package.revisions.min)
    .max(FIVERR.package.revisions.max),
})

const FaqShape = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
})

const GenerationShape = z.object({
  // Short tool/platform/niche term, e.g. "lovable", "replit", "next.js".
  // We cap at 30 chars to discourage long phrases — those are searchKeywords.
  primaryKeyword: z.string().trim().min(2).max(30),
  title: z.string().min(10),
  description: z.string().min(50),
  tags: z.array(z.string().min(1)).length(FIVERR.tag.count),
  searchKeywords: z.array(z.string().min(1)).min(6).max(12),
  faqs: z.array(FaqShape).min(FIVERR.faq.count.min).max(FIVERR.faq.count.max),
  packages: z.array(PackageShape).length(3),
  requirements: z
    .array(z.string().min(1))
    .min(FIVERR.requirement.count.min)
    .max(FIVERR.requirement.count.max),
  thumbnailIdeas: z.array(z.string().min(1)).min(3).max(5),
  gigImagePrompt: z.string().min(20),
  buyerAiQuestions: z.array(z.string().min(8)).min(3).max(6).default([]),
  visibilityActions: z.array(z.string().min(12)).min(3).max(6).default([]),
})

// ---------- JSON Schema mirror for OpenAI strict structured outputs ----------

// NOTE: OpenAI strict structured outputs DO NOT support maxLength /
// minItems / maxItems / numeric range constraints. Field-level limits are
// enforced by:
//   1. the system prompt (which spells out every cap explicitly),
//   2. the Zod schema below (which the validator wrapper checks after parse),
//   3. the wrapper's retry + smart-truncate fallback in
//      `lib/llm/with-fiverr-validation.ts`.
// Keep this JSON Schema minimal — it just enforces the SHAPE.

const packageJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tier: { type: "string", enum: ["Basic", "Standard", "Premium"] },
    name: { type: "string" },
    description: { type: "string" },
    price: { type: "number" },
    deliveryDays: { type: "integer" },
    revisions: { type: "integer" },
  },
  required: [
    "tier",
    "name",
    "description",
    "price",
    "deliveryDays",
    "revisions",
  ],
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

const generationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    primaryKeyword: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    searchKeywords: { type: "array", items: { type: "string" } },
    faqs: { type: "array", items: faqJsonSchema },
    packages: { type: "array", items: packageJsonSchema },
    requirements: { type: "array", items: { type: "string" } },
    thumbnailIdeas: { type: "array", items: { type: "string" } },
    gigImagePrompt: { type: "string" },
    buyerAiQuestions: { type: "array", items: { type: "string" } },
    visibilityActions: { type: "array", items: { type: "string" } },
  },
  required: [
    "primaryKeyword",
    "title",
    "description",
    "tags",
    "searchKeywords",
    "faqs",
    "packages",
    "requirements",
    "thumbnailIdeas",
    "gigImagePrompt",
    "buyerAiQuestions",
    "visibilityActions",
  ],
} as const

// ---------- Trend context helpers ----------

function renderTrendContext(snapshot: NicheSnapshot | null): string {
  if (!snapshot || snapshot.gigs.length === 0) {
    return "(No live competitor data available for this niche — generate from best practices.)"
  }
  const topKeywords = snapshot.keywords
    .slice(0, 15)
    .map((k) => `${k.keyword} (${k.count})`)
    .join(", ")
  const sampleTitles = snapshot.gigs
    .slice(0, 6)
    .map((g, i) => `${i + 1}. ${g.title}`)
    .join("\n")
  const stats = snapshot.priceStats
  return [
    `Niche "${snapshot.name}" intelligence (scraped ${snapshot.scrapedAt ?? "n/a"}):`,
    `- Top keywords: ${topKeywords}`,
    `- Price range: $${stats.min}–$${stats.max} (median $${stats.median})`,
    `- Sample top gig titles:\n${sampleTitles}`,
  ].join("\n")
}

// ---------- Smart-truncate fallback for the validator wrapper ----------

function truncateGeneration(gen: GigGeneration): GigGeneration {
  return {
    ...gen,
    title: softTruncate(gen.title, FIVERR.title.max),
    description: softTruncate(gen.description, FIVERR.description.max),
    tags: gen.tags
      .slice(0, FIVERR.tag.count)
      .map((t) => softTruncate(t.toLowerCase(), FIVERR.tag.max)),
    faqs: gen.faqs.map((f) => ({
      question: softTruncate(f.question, FIVERR.faq.question.max),
      answer: softTruncate(f.answer, FIVERR.faq.answer.max),
    })),
    packages: gen.packages.map((p) => ({
      ...p,
      name: softTruncate(p.name, FIVERR.package.name.max),
      description: softTruncate(p.description, FIVERR.package.description.max),
    })),
    requirements: gen.requirements.map((r) =>
      softTruncate(r, FIVERR.requirement.item.max),
    ),
    buyerAiQuestions: (gen.buyerAiQuestions ?? []).slice(0, 6),
    visibilityActions: (gen.visibilityActions ?? []).slice(0, 6),
  }
}

// ---------- Route ----------

export async function POST(req: Request) {
  // 1. Parse body
  let bodyJson: unknown
  try {
    bodyJson = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    )
  }
  const parsed = RequestSchema.safeParse(bodyJson)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    )
  }
  const { niche, skill, tools, audience, experienceLevel } = parsed.data

  // 1b. IP rate limit (defense in depth on top of per-user quota).
  const ip = ipFromRequest(req)
  const rl = checkRateLimit({
    key: `${ip}:generate`,
    limit: GENERATE_RATE_LIMIT,
    windowMs: GENERATE_RATE_WINDOW_MS,
  })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: rl.message, retryAfterSec: rl.retryAfterSec },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    )
  }

  // 2. Auth + quota
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
      { error: "You must be signed in to generate gigs" },
      { status: 401 },
    )
  }
  // Fast pre-check for UX — surfaces the paywall without the user
  // waiting for the LLM call to start. The authoritative gate is the
  // atomic reservation below; this just avoids a wasted round trip on
  // the obvious "no credits left" case.
  const quota = await getQuotaStatus(user.id)
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: quota.isPremium
          ? "You've used all your monthly AI credits. Buy a credit top-up to keep going."
          : "Free plan limit reached. Upgrade to Pro or buy a credit top-up.",
        quota,
      },
      { status: 402 },
    )
  }

  // 2b. Atomic reservation. Inserts a placeholder row into
  // `gig_generations` BEFORE the LLM call so:
  //   - concurrent /api/generate requests can't both pass the pre-check
  //     and both run the LLM (the advisory lock inside the RPC serializes
  //     reservations per-user),
  //   - if the metering insert fails for any reason (table missing, RLS,
  //     etc.) we fail loudly with a 500 instead of giving the user a
  //     free generation.
  // Returns the row id we'll UPDATE on success, or DELETE on LLM failure.
  let reservationId: string | null
  try {
    reservationId = await reserveCreditSlot({
      userId: user.id,
      kind: "generation",
      payload: { niche: parsed.data.niche },
    })
  } catch (err) {
    console.error("[generate] reservation failed:", err)
    return NextResponse.json(
      {
        error:
          "Couldn't reserve a credit slot. Please try again — if this keeps happening contact support.",
      },
      { status: 500 },
    )
  }
  if (!reservationId) {
    // Slipped past the pre-check (concurrent request just consumed the
    // last slot). Return 402 so the client opens the paywall.
    return NextResponse.json(
      {
        error: quota.isPremium
          ? "You've used all your monthly AI credits. Buy a credit top-up to keep going."
          : "Free plan limit reached. Upgrade to Pro or buy a credit top-up.",
        quota,
      },
      { status: 402 },
    )
  }

  // 3. Trend context (best effort)
  let snapshot: NicheSnapshot | null = null
  try {
    const all = await getAllCachedSnapshots()
    snapshot = all.find((s) => s.slug === niche) ?? null
  } catch {
    // Trend lookup is purely advisory — fall through silently.
  }
  // For predefined niches this returns the catalog name; for custom
  // user-added niches it falls back to a Title-Cased slug ("Tarot
  // Reading"). Either way the AI gets a human-readable hint.
  const nicheName = getNicheDisplayName(niche)
  const trendingTerms = renderTrendingTerms(niche)

  // 4. Build the system + user prompts.
  // (Provider readiness — OPENAI_API_KEY or GEMINI_API_KEY — is enforced
  // inside the provider when the call actually fires, so we don't gate here.)

  const systemPrompt = [
    "You are JobFlow AI, a Fiverr listing strategist whose job is more orders — ranking without conversion is wasted impressions.",
    "You craft brand new Fiverr listings that are optimized for ranking AND buyer conversion.",
    "Return strictly valid JSON matching the schema. Never fabricate competitor data.",
    "",
    FIVERR_WINNING_RULES,
    "",
    FREELANCER_VISIBILITY_RULES,
    "",
    "WORKFLOW",
    "1. Pick ONE primaryKeyword — a SHORT, specific tool/style/sub-category term buyers in THIS niche actually type into Fiverr search.",
    "   Prefer single words or short brand/style names. The right pick depends on the niche:",
    "     - logo design → 'minimalist', 'mascot', 'wordmark', 'vector'",
    "     - video editing → 'reels', 'youtube', 'capcut', 'premiere'",
    "     - voiceover → 'commercial', 'e-learning', 'audiobook'",
    "     - content writing → 'seo', 'blog', 'ghostwriting'",
    "     - web dev → 'nextjs', 'shopify', 'webflow'",
    "   Bad picks: long descriptive phrases like 'AI-powered SaaS development' or 'website creation services'. Keep it 1-3 words max.",
    "   Lean on the trend intelligence below if provided.",
    `2. Place the primaryKeyword (exact match) ${FIVERR.keyword.descMin}-${FIVERR.keyword.descMax} times in the DESCRIPTION — natural buyer copy, not stuffing. Pattern: once in the opening hook (first 1-2 sentences), once in deliverables/body, once near the CTA.`,
    `   - Title: include the primaryKeyword ${FIVERR.keyword.titleMin}-${FIVERR.keyword.titleMax} time(s) inside the ${FIVERR.title.max}-char cap, near the front, inside a readable outcome title (e.g. "I will design a minimalist logo that makes your brand look established"). Never pipe-separate keyword dumps.`,
    `   - Tags: ${FIVERR.keyword.tagMin}-${FIVERR.keyword.tagMax} of the ${FIVERR.tag.count} tags should contain the primaryKeyword; the remaining ${FIVERR.tag.count - FIVERR.keyword.tagMax}+ tags MUST be DIFFERENT long-tail phrases buyers actually search for (use Fiverr's autocomplete-style multi-word queries, NOT repeats of the title).`,
    "   - FAQs: mention the keyword at most once across all answers combined; use FAQs for secondary / long-tail buyer phrases.",
    "   - Everything else: focus on conversion copy, not keyword density.",
    "",
    `WRITING THE DESCRIPTION (relevance + conversion):`,
    `You need ${FIVERR.keyword.descMin}-${FIVERR.keyword.descMax} exact-match mentions of the primaryKeyword inside ${FIVERR.description.optimalMin}-${FIVERR.description.optimalMax} characters. Structure as Hook → Credibility → Deliverables → Process → What I need → CTA:`,
    `  - Lead with a buyer-problem hook that uses the primaryKeyword in the first sentence.`,
    `  - Use the primaryKeyword once in the deliverables / process section and once near the CTA.`,
    `  - Do NOT repeat the same phrase every paragraph — stuffing (≥7×) hurts ranking and conversion.`,
    `  - Sprinkle SEMANTIC VARIANTS (synonyms / related phrases) for topical coverage. Examples:`,
    `      "logo design" → "logo identity", "brand mark", "logo creation"`,
    `      "ai app" → "ai application", "ai tool", "intelligent app"`,
    `      "video editing" → "video production", "post-production", "cut and edit"`,
    `Aim for roughly ${FIVERR.keyword.semanticVariantsRecommended} different semantic variants on top of the ${FIVERR.keyword.descMin}-${FIVERR.keyword.descMax} exact mentions.`,
    "3. Generate every other field. Each field BELOW must paste cleanly into Fiverr without edits.",
    "",
    "FIVERR FIELD CONSTRAINTS — HARD CAPS Fiverr will reject if exceeded:",
    `- title: max ${FIVERR.title.max} chars, target ${FIVERR.title.optimalMin}-${FIVERR.title.optimalMax}. Must start with "I will ". Prefer action + deliverable + buyer outcome. Include the primaryKeyword ${FIVERR.keyword.titleMin}-${FIVERR.keyword.titleMax} time(s) (HARD MINIMUM ${FIVERR.keyword.titleMin}), naturally near the front. Never use these characters: & / | # @ % "`,
    `- description: max ${FIVERR.description.max} chars, target ${FIVERR.description.optimalMin}-${FIVERR.description.optimalMax}. Plain text, short paragraphs or '- ' bullets for deliverables. Follow Hook → Credibility → Deliverables → Process → What I need → CTA. The primaryKeyword appears ${FIVERR.keyword.descMin}-${FIVERR.keyword.descMax} times (HARD MINIMUM ${FIVERR.keyword.descMin}). No markdown.`,
    `- tags: EXACTLY ${FIVERR.tag.count} tags, each max ${FIVERR.tag.max} chars, lowercase letters/numbers/spaces/hyphens only. ${FIVERR.keyword.tagMin}-${FIVERR.keyword.tagMax} tags contain the primaryKeyword; the remaining tags are DIFFERENT long-tail buyer queries (e.g. "logo for restaurant", "minimalist coffee shop logo"), NOT duplicates or stems of the primary keyword.`,
    "- searchKeywords: 6-12 longer-tail buyer search phrases for the seller's own SEO research. NOT a Fiverr field — just brainstorming.",
    `- faqs: ${FIVERR.faq.count.min}-${FIVERR.faq.count.max} entries. Question max ${FIVERR.faq.question.max} chars, answer max ${FIVERR.faq.answer.max} chars. Real buyer objections for THIS niche (formats, revisions, source files, commercial use, turnaround, rush) — written to remove the need to message before ordering.`,
    "- packages: EXACTLY 3 tiers (Basic, Standard, Premium).",
    `    - name: short outcome-oriented tier name, max ${FIVERR.package.name.max} chars.`,
    `    - description: ONE paste-able sentence describing what's included at this tier, max ${FIVERR.package.description.max} chars. NOT bullets. Write copy a buyer reads in 2 seconds — lead with the result.`,
    "    - price: USD, reflect the niche's median; Premium must clearly justify the price jump with a business outcome.",
    `    - deliveryDays: ${FIVERR.package.deliveryDays.min}-${FIVERR.package.deliveryDays.max}.`,
    `    - revisions: ${FIVERR.package.revisions.min}-${FIVERR.package.revisions.max}.`,
    `- requirements: ${FIVERR.requirement.count.min}-${FIVERR.requirement.count.max} buyer-input prompts that unblock delivery. Each max ${FIVERR.requirement.item.max} chars. Specific, not vague — logo: "Share your brand name and 2-3 reference logos you like." / video: "Send the raw footage and any brand colors." / voiceover: "Paste the script and let me know your target accent.".`,
    "- thumbnailIdeas: 3-5 concrete visual concepts (subject, color, headline copy) the seller can brief a designer with — appropriate to what's actually being sold (logo mark previews for designers, before/after stills for video editors, mic+waveform shots for voiceover, etc.).",
    "- gigImagePrompt: a single ready-to-paste prompt for an AI image generator (Midjourney/DALL-E style) describing the hero thumbnail.",
    "- buyerAiQuestions: 3-6 questions a client would ask ChatGPT/Perplexity when hiring in THIS niche (e.g. 'best freelancer for Stripe Connect SaaS billing'). Seller can own these in FAQs / LinkedIn / portfolio.",
    "- visibilityActions: 3-5 concrete SEO/AEO/GEO steps after publishing (FAQ paste, first-sentence answer, one proof metric, niche-consistent LinkedIn bio).",
    "",
    "If niche intelligence is provided below, ground keyword and pricing choices in it — the real competitor titles and keywords tell you what buyers in this niche actually search for.",
    trendingTerms
      ? `Otherwise, common trending terms in this niche include: ${trendingTerms}. Use only what's relevant to the seller's specific skill.`
      : "Otherwise, mirror the language real Fiverr buyers in this exact niche use — do NOT default to AI/dev jargon unless the gig is genuinely a dev gig.",
  ].join("\n")

  const userPrompt = [
    `Niche: ${nicheName} (slug: ${niche})`,
    `Specific skill: ${skill}`,
    `Tools / stack: ${tools.join(", ")}`,
    `Target audience: ${audience || "the typical buyer for this niche"}`,
    `Seller experience level: ${experienceLevel}`,
    "",
    "Niche intelligence:",
    renderTrendContext(snapshot),
  ].join("\n")

  // 5. Call the LLM with validate -> retry -> truncate
  let outcome
  try {
    outcome = await runWithFiverrValidation<GigGeneration>({
      model: "smart",
      temperature: 0.55,
      schema: generationJsonSchema,
      schemaName: "GigGeneration",
      // Full gig generation (description + tags + searchKeywords + FAQs +
      // 3 packages + requirements + thumbnail ideas) lands around
      // ~3.5k output tokens. 4096 leaves headroom without unbounded burn.
      maxOutputTokens: 4096,
      buildMessages: () => [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      buildRetryMessages: (base, feedback, previous) => [
        ...base,
        {
          role: "assistant",
          content: JSON.stringify(previous),
        },
        {
          role: "user",
          content: [
            feedback,
            "",
            "Return the corrected JSON now, keeping everything that was already compliant.",
          ].join("\n"),
        },
      ],
      parse: (raw) => {
        // SHAPE-only parse — field-length caps are checked by the wrapper's
        // violation collector so they trigger the retry path instead of an
        // outright throw.
        const json = JSON.parse(raw)
        const result = GenerationShape.safeParse(json)
        if (!result.success) {
          throw new Error(
            `Generation shape mismatch: ${result.error.issues[0]?.message ?? "unknown"}`,
          )
        }
        return result.data satisfies GigGeneration
      },
      toCheckable: (gen): FiverrCheckable => ({
        primaryKeyword: gen.primaryKeyword,
        title: gen.title,
        description: gen.description,
        tags: gen.tags,
        faqs: gen.faqs,
        packages: gen.packages,
        requirements: gen.requirements,
      }),
      truncate: truncateGeneration,
    })
  } catch (err) {
    // LLM call (or the validator wrapper) failed. Roll back the
    // reservation so the user isn't charged for compute they didn't get.
    await releaseReservation("gig_generations", reservationId)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Generation failed: ${message}` },
      { status: 502 },
    )
  }

  // Persist the real generation onto the reservation row. The row was
  // inserted up-front so it already counts against the user's quota
  // even if this update fails. We log update failures but proceed —
  // history will show a placeholder, but metering is intact.
  await updateReservation("gig_generations", reservationId, {
    generation: outcome.data,
  })

  // Bill the credit. The row already exists, so chargeCredit's post-
  // insert recount sees the up-to-date number and either no-ops
  // (monthly bucket) or decrements a topup row.
  await chargeCredit(user.id)

  return NextResponse.json(
    {
      generation: outcome.data,
      niche,
      warnings: outcome.warnings,
    },
    { status: 200 },
  )
}
