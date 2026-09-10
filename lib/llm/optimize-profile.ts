/**
 * LLM optimizer for Fiverr / Upwork seller profiles.
 * URL-first: scrapes public profile text, then rewrites + scores professionalism.
 */

import { z } from "zod"

import {
  FIVERR_PROFILE_RULES,
  FREELANCER_VISIBILITY_RULES,
  UPWORK_PROFILE_RULES,
} from "@/lib/llm/conversion-playbook"
import { getLlmProvider } from "@/lib/llm/provider"
import { callWithTruncationRetry, safeJsonParse } from "@/lib/llm/truncation"
import type {
  AccountStage,
  ProfileOptimizeInput,
  ProfileOptimization,
  ProfilePlatform,
} from "@/lib/profile-optimizer-types"
import {
  accountStageLabel,
  rateBandForStage,
  verdictFromScore,
} from "@/lib/profile-optimizer-types"
import {
  detectRateFamily,
  rateFamilyLabel,
  type RateFamily,
} from "@/lib/niche-rates"
import {
  DEFAULT_PROFILE_CHECKLIST,
  cleanChecklist,
  cleanProofQuotes,
} from "@/lib/visibility-types"

const ActionStepSchema = z.object({
  title: z.string().min(4).max(120),
  detail: z.string().min(12).max(500),
})

const VisibilityItemSchema = z.object({
  id: z.string().min(2).max(48),
  layer: z.enum(["seo", "aeo", "geo", "aio"]),
  title: z.string().min(4).max(100),
  detail: z.string().min(12).max(320),
})

const OptimizationSchema = z.object({
  score: z.number().min(0).max(100),
  accountStage: z
    .enum(["getting_started", "building_proof", "established"])
    .default("getting_started"),
  headline: z.string().min(8).max(200),
  overview: z.string().min(80).max(5000),
  skills: z.array(z.string()).default([]),
  suggestedRateUsd: z.number().min(5).max(500).nullable(),
  suggestedRateNote: z.string().max(280).default(""),
  winAngles: z.array(z.string()).default([]),
  actionPlan: z.array(ActionStepSchema).default([]),
  /** Legacy flat checklist — mapped into actionPlan if needed. */
  editChecklist: z.array(z.string()).default([]),
  critique: z.array(z.string()).default([]),
  proofQuotes: z.array(z.string()).default([]),
  geoTips: z.array(z.string()).default([]),
  visibilityChecklist: z.array(VisibilityItemSchema).default([]),
})

const DEFAULT_WIN = [
  "Leads with a clear specialty buyers can scan in under 3 seconds.",
  "Replaces vague bio language with outcome-focused, client-friendly copy.",
]
const DEFAULT_ACTION_STARTED = [
  {
    title: "Update your headline",
    detail:
      "Paste the new niche-specific headline so clients instantly see what you deliver.",
  },
  {
    title: "Replace the overview",
    detail:
      "Paste the rewrite — lead with one clear offer and how you work, not a resume dump.",
  },
  {
    title: "Set an entry hourly rate",
    detail:
      "Use the suggested entry rate so clients are not filtered out by a premium price before you have reviews.",
  },
  {
    title: "Add proof that stands out",
    detail:
      "Upload 2–3 portfolio samples or a short Loom walkthrough so low-risk clients can hire you without reviews.",
  },
]

const DEFAULT_ACTION = [
  {
    title: "Update your headline",
    detail: "Paste the new headline into your live profile and save.",
  },
  {
    title: "Replace the overview",
    detail:
      "Paste the full rewrite, then add one real proof metric if you have it.",
  },
  {
    title: "Set your rate",
    detail: "Apply the suggested rate so your profile signals market value.",
  },
  {
    title: "Align skills",
    detail: "Add the suggested skills and remove vague or duplicate tags.",
  },
]
const DEFAULT_CRITIQUE = [
  "Original profile needed clearer positioning for buyers scanning quickly.",
]

/**
 * Infer traction stage from scrape density when the model is optimistic.
 * Thin proof → getting_started so we never push $95/hr advice.
 */
export function inferAccountStage(signals?: {
  namedClients: number
  portfolioTitles: number
  workHistory: number
  overviewLength: number
  score?: number
}): AccountStage {
  if (!signals) return "getting_started"
  const proof =
    (signals.namedClients > 0 ? 1 : 0) +
    (signals.portfolioTitles >= 2 ? 1 : 0) +
    (signals.workHistory >= 1 ? 1 : 0) +
    (signals.overviewLength >= 800 ? 1 : 0)
  const score = signals.score ?? 50

  if (proof <= 1 || score < 55) return "getting_started"
  if (proof <= 3 || score < 75) return "building_proof"
  return "established"
}

function resolveStage(
  llmStage: AccountStage,
  signals?: ProfileOptimizeInput["signals"],
  score?: number,
): AccountStage {
  const heuristic = inferAccountStage({
    namedClients: signals?.namedClients ?? 0,
    portfolioTitles: signals?.portfolioTitles ?? 0,
    workHistory: signals?.workHistory ?? 0,
    overviewLength: signals?.overviewLength ?? 0,
    score,
  })
  // Prefer the more conservative of model vs heuristic (never upgrade past heuristic).
  const rank: Record<AccountStage, number> = {
    getting_started: 0,
    building_proof: 1,
    established: 2,
  }
  return rank[llmStage] <= rank[heuristic] ? llmStage : heuristic
}

function clampRate(
  platform: ProfilePlatform,
  stage: AccountStage,
  family: RateFamily,
  rate: number | null,
): {
  rate: number | null
  clamped: boolean
  band: ReturnType<typeof rateBandForStage>
} {
  const band = rateBandForStage(platform, stage, family)
  if (rate == null || !Number.isFinite(rate)) {
    return { rate: band.target, clamped: true, band }
  }
  const rounded = Math.round(rate)
  if (rounded > band.max) return { rate: band.target, clamped: true, band }
  if (rounded < band.min) return { rate: band.min, clamped: true, band }
  return { rate: rounded, clamped: false, band }
}

function defaultRateNote(
  platform: ProfilePlatform,
  stage: AccountStage,
  familyLabel: string,
): string {
  if (platform === "fiverr") {
    if (stage === "getting_started") {
      return `Entry ${familyLabel} package price to win first orders — stand out on offer clarity, then raise after reviews.`
    }
    return `${familyLabel} package price matched to your traction — adjust tiers to deliverables.`
  }
  if (stage === "getting_started") {
    return `Entry ${familyLabel} rate for winning first jobs in this niche — not a premium expert rate. Stand out with a specific offer + samples, then raise after 3–5 reviews.`
  }
  if (stage === "building_proof") {
    return `Mid-market ${familyLabel} rate after early reviews — raise ~10–20% after each few wins.`
  }
  return `Market ${familyLabel} positioning for an established profile — bid higher or lower per job as needed.`
}

/** Strip markdown so overviews paste cleanly into Upwork/Fiverr. */
export function stripProfileMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "")
    .replace(/^\s*•\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function cleanStrings(items: string[], minLen = 3): string[] {
  return items
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length >= minLen)
}

function padList(
  items: string[],
  fallbacks: string[],
  min: number,
  max: number,
): string[] {
  const out = [...items]
  for (const fb of fallbacks) {
    if (out.length >= min) break
    if (!out.includes(fb)) out.push(fb)
  }
  while (out.length < min) {
    out.push(`Review item ${out.length + 1} before publishing.`)
  }
  return out.slice(0, max)
}

function normalizeActionPlan(
  steps: Array<{ title: string; detail: string }>,
  legacy: string[],
  stage: AccountStage,
): Array<{ title: string; detail: string }> {
  const defaults =
    stage === "getting_started" ? DEFAULT_ACTION_STARTED : DEFAULT_ACTION
  const fromModel = steps
    .map((s) => ({
      title: s.title.trim(),
      detail: s.detail.trim(),
    }))
    .filter((s) => s.title.length >= 4 && s.detail.length >= 12)

  if (fromModel.length >= 4) return fromModel.slice(0, 8)

  const fromLegacy = legacy
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .map((line) => {
      const split = line.match(/^(.+?)[:—–-]\s*(.+)$/)
      if (split) {
        return { title: split[1].trim(), detail: split[2].trim() }
      }
      return { title: line.slice(0, 80), detail: line }
    })

  const merged = [...fromModel]
  for (const step of [...fromLegacy, ...defaults]) {
    if (merged.length >= 4) break
    if (!merged.some((m) => m.title === step.title)) merged.push(step)
  }
  while (merged.length < 4) {
    merged.push(defaults[merged.length % defaults.length])
  }
  return merged.slice(0, 8)
}

function rateLabel(platform: ProfilePlatform, stage: AccountStage): string {
  if (platform === "upwork") {
    return stage === "getting_started"
      ? "Suggested entry hourly rate"
      : "Suggested hourly rate"
  }
  return stage === "getting_started"
    ? "Suggested entry package price"
    : "Suggested starting price"
}

function normalize(
  platform: ProfilePlatform,
  data: z.infer<typeof OptimizationSchema>,
  signals?: ProfileOptimizeInput["signals"],
  family: RateFamily = "general",
): ProfileOptimization {
  const score = Math.max(0, Math.min(100, Math.round(data.score)))
  const { verdict, verdictLabel } = verdictFromScore(score)
  const accountStage = resolveStage(data.accountStage, signals, score)
  const actionPlan = normalizeActionPlan(
    data.actionPlan,
    data.editChecklist,
    accountStage,
  )
  const { rate, clamped, band } = clampRate(
    platform,
    accountStage,
    family,
    data.suggestedRateUsd != null && Number.isFinite(data.suggestedRateUsd)
      ? data.suggestedRateUsd
      : null,
  )
  const familyLabel = band.label || rateFamilyLabel(family)

  let note = data.suggestedRateNote.trim()
  if (!note || clamped || accountStage === "getting_started") {
    if (clamped || accountStage === "getting_started" || !note) {
      note = defaultRateNote(platform, accountStage, familyLabel)
    }
  }

  return {
    platform,
    score,
    verdict,
    verdictLabel,
    headline: stripProfileMarkdown(data.headline.trim()),
    overview: stripProfileMarkdown(data.overview.trim()).replace(/\*/g, ""),
    skills: padList(cleanStrings(data.skills, 2), ["Specialty TBD"], 4, 15),
    suggestedRateUsd: rate,
    suggestedRateLabel: rateLabel(platform, accountStage),
    suggestedRateNote: note,
    accountStage,
    accountStageLabel: accountStageLabel(accountStage),
    rateFamily: family,
    rateFamilyLabel: familyLabel,
    winAngles: padList(cleanStrings(data.winAngles), DEFAULT_WIN, 2, 5),
    actionPlan,
    editChecklist: actionPlan.map(
      (s, i) => `${i + 1}. ${s.title}: ${s.detail}`,
    ),
    critique: padList(cleanStrings(data.critique), DEFAULT_CRITIQUE, 2, 6),
    proofQuotes: cleanProofQuotes(data.proofQuotes, 4),
    geoTips: cleanStrings(data.geoTips, 12).slice(0, 4),
    visibilityChecklist: cleanChecklist(
      data.visibilityChecklist,
      DEFAULT_PROFILE_CHECKLIST,
      4,
      7,
    ),
  }
}

function platformOverviewInstructions(platform: ProfilePlatform): string {
  if (platform === "upwork") {
    return [
      "UPWORK OVERVIEW LENGTH (critical):",
      "- Hard max 5,000 characters. TARGET 2,000–3,500 characters (count characters, not words).",
      "- First 200–250 characters must be a strong hook (visible before Read more).",
      "- PLAIN TEXT only — no **, *, #, backticks, or markdown links.",
      "- Structure: (1) two result-driven opening sentences for search snippet, (2) who you're a good fit for, (3) business benefits, (4) optional bad-fit line, (5) how you work, (6) proof from scrape only, (7) short about-me last, (8) soft CTA.",
      "UPWORK TITLE: max 70 characters — niche + outcome, NEVER stack-soup or title-repeat.",
      "accountStage: getting_started | building_proof | established from scrape proof (jobs, portfolio, clients).",
      "suggestedRateUsd: MUST match THIS niche's market AND accountStage.",
      "  Examples (getting_started entry): web/dev ~$18–28, writing/copy ~$12–22, email/SEO/marketing ~$12–24, design ~$15–25, VA ~$8–15, AI/ML ~$40–55 (still entry for AI).",
      "  Established SaaS payments/billing specialists can sit above generic full-stack once proof is clear.",
      "  Never suggest a web-dev or AI rate to a writer. Never suggest $80–$150 to a struggling account in any niche.",
      "TRUTH: Only name clients/people/companies listed under Named clients / work history in the scrape. If none, write without naming clients.",
    ].join("\n")
  }
  return [
    "FIVERR DESCRIPTION: buyer-first, scannable, ~400–1,200 characters unless more proof is available.",
    "PLAIN TEXT only — no markdown asterisks.",
    "accountStage: getting_started if few/no reviews or thin gigs; do not suggest premium package prices for early sellers.",
    "suggestedRateUsd: niche-appropriate starting package (writing cheaper than web/dev; marketing mid; AI higher).",
    "TRUTH: Never invent clients or metrics not in the scrape.",
  ].join("\n")
}

export async function optimizeSellerProfile(
  input: ProfileOptimizeInput,
): Promise<ProfileOptimization> {
  const provider = getLlmProvider()
  const tone = input.tone ?? "professional"
  const platformRules =
    input.platform === "fiverr" ? FIVERR_PROFILE_RULES : UPWORK_PROFILE_RULES

  const rateFamily = detectRateFamily({
    nicheSlugs: input.nicheSlugs,
    profileText: input.profileText,
  })
  const familyBand = rateBandForStage(
    input.platform,
    "getting_started",
    rateFamily,
  )

  const systemPrompt = [
    "You are JobFlow AI, a freelance profile coach for Fiverr and Upwork.",
    "You rewrite seller profiles to look professional, specific, and client-friendly — never generic AI filler.",
    "Return strictly valid JSON matching the schema.",
    "",
    `PLATFORM: ${input.platform.toUpperCase()}`,
    platformRules,
    "",
    FREELANCER_VISIBILITY_RULES,
    "",
    platformOverviewInstructions(input.platform),
    "",
    `DETECTED NICHE RATE FAMILY: ${rateFamilyLabel(rateFamily)} (${rateFamily}).`,
    `For a getting_started seller in this niche, stay near $${familyBand.min}–$${familyBand.max}/hr (target ~$${familyBand.target}).`,
    "Do NOT borrow rates from other niches (writers ≠ web developers ≠ AI engineers).",
    "",
    `Tone: ${tone}.`,
    "score: honest 0-100 professionalism + conversion readiness of the CURRENT scraped profile (before rewrite).",
    "Be strict: vague hobbies, buzzwords, 'passionate freelancer', or no clear offer should score under 60.",
    "accountStage: classify traction from the scrape ONLY (getting_started | building_proof | established).",
    "  If thin portfolio, no named clients, weak/short overview, or clearly struggling → getting_started.",
    "  For getting_started: prioritize standout niche title + clear offer + proof samples; NEVER suggest premium hourly rates.",
    "headline: paste-ready title/headline for THIS platform's character limits — keep it tight. No markdown.",
    "overview: paste-ready about/overview. PLAIN TEXT only (no ** or * markdown). Short paragraphs.",
    "skills: 4-15 concrete skill labels appropriate to the platform — prefer skills already present.",
    "critique: 2-6 specific issues in the ORIGINAL text — MUST call out when present: greeting openers, title-repeat first lines, stack-soup headlines, too many equal-weight niches, vague portfolio metrics, templated employment padding, grammar/sloppiness.",
    "actionPlan: 5-7 ordered steps. Each has title (what to do) + detail (exactly how on the live profile).",
    "  Must cover: niche headline, overview paste (snippet-first), niche skills, 3 case-study reframes, stage-appropriate rate, and a 'search yourself as a client' beta-test step.",
    "  For getting_started, rate step must say 'entry rate to win first jobs' — not 'signal market value'.",
    "  Skip video-intro steps unless the scrape already leans on video.",
    "suggestedRateNote: one sentence explaining the rate for THIS stage AND niche without inventing credentials.",
    "winAngles: 2-5 why the rewrite helps win clients + Uma matching (niche density, snippet, skills) — not premium pricing for early accounts.",
    "proofQuotes: 1-2 short citable lines grounded ONLY in scrape facts (or honest capability claims if thin proof). Never invent metrics.",
    "geoTips: 2-3 short GEO/AIO tips (one sentence each).",
    "visibilityChecklist: 4-5 items with layer seo|aeo|geo|aio (short title + one-sentence detail).",
    "Keep visibility fields SHORT — long JSON causes timeouts. Put depth in the overview, not the extras.",
    "GROUNDING (critical):",
    "- The scraped block is the ONLY source of truth.",
    "- NEVER invent clients, companies, countries, tools, earnings, or ratings.",
    "- If 'Named clients' says none found, do not invent any. Write capability + process without fake logos.",
    "- When named clients/work history/portfolio titles exist, weave those real names into the overview naturally.",
  ].join("\n")

  const userPrompt = [
    `Profile URL: ${input.profileUrl}`,
    `Platform: ${input.platform}`,
    "",
    "SCRAPED PROFILE TEXT (source of truth — rewrite from this ONLY):",
    "-----",
    input.profileText.slice(0, 10000),
    "-----",
    "",
    input.platform === "upwork"
      ? "Classify accountStage, then produce a full Upwork package: 70-char headline, 2000–3500 character PLAIN-TEXT overview (no asterisks), stage-appropriate hourly rate (entry if getting_started — never premium), skills, critique, win angles, and a clear numbered action plan focused on standing out. Cite only clients/people explicitly listed above."
      : "Classify accountStage, score the CURRENT profile, then produce an optimized package with a clear action plan. Plain text only. Never invent clients. Entry pricing if early-stage.",
  ].join("\n")

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "score",
      "accountStage",
      "headline",
      "overview",
      "skills",
      "suggestedRateUsd",
      "suggestedRateNote",
      "winAngles",
      "actionPlan",
      "critique",
      "proofQuotes",
      "geoTips",
      "visibilityChecklist",
    ],
    properties: {
      score: {
        type: "number",
        description:
          "0-100 professionalism score of the current scraped profile.",
      },
      accountStage: {
        type: "string",
        enum: ["getting_started", "building_proof", "established"],
        description:
          "Traction stage from scrape proof. Use getting_started when struggling / thin proof.",
      },
      headline: {
        type: "string",
        description:
          "Paste-ready Fiverr title or Upwork profile headline (Upwork ≤70 chars).",
      },
      overview: {
        type: "string",
        description:
          "Paste-ready overview as PLAIN TEXT only (no markdown **, *, #). Upwork: 2000–3500 characters. Strong first 250 chars. Only real clients from scrape.",
      },
      skills: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 15,
        description: "Suggested skills / specialties.",
      },
      suggestedRateUsd: {
        anyOf: [{ type: "number" }, { type: "null" }],
        description:
          "Stage-aware Upwork hourly or Fiverr package USD. getting_started must stay in entry band.",
      },
      suggestedRateNote: {
        type: "string",
        description: "One sentence justifying the suggested rate for this stage.",
      },
      winAngles: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
      },
      actionPlan: {
        type: "array",
        minItems: 4,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "detail"],
          properties: {
            title: {
              type: "string",
              description: "Short step title (e.g. Set hourly rate).",
            },
            detail: {
              type: "string",
              description: "Concrete how-to for the live profile.",
            },
          },
        },
      },
      critique: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 6,
      },
      proofQuotes: {
        type: "array",
        items: { type: "string" },
        maxItems: 4,
        description: "Citable proof lines grounded in scrape only.",
      },
      geoTips: {
        type: "array",
        items: { type: "string" },
        maxItems: 4,
        description: "GEO/AIO tips outside the marketplace profile.",
      },
      visibilityChecklist: {
        type: "array",
        maxItems: 7,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "layer", "title", "detail"],
          properties: {
            id: { type: "string" },
            layer: {
              type: "string",
              enum: ["seo", "aeo", "geo", "aio"],
            },
            title: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }

  const raw = await callWithTruncationRetry(
    (maxOutputTokens) =>
      provider.completeStructured({
        model: "smart",
        temperature: 0.4,
        maxOutputTokens,
        schemaName: "profile_optimization",
        schema,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    12_288,
    "profile-optimize",
  )

  const parsed = OptimizationSchema.safeParse(safeJsonParse(raw))
  if (!parsed.success) {
    throw new Error(
      `Profile model returned invalid JSON: ${parsed.error.message}`,
    )
  }

  let normalized = normalize(
    input.platform,
    parsed.data,
    input.signals,
    rateFamily,
  )

  // One repair pass if Upwork overview is too short for the 2k–3.5k target.
  if (
    input.platform === "upwork" &&
    normalized.overview.length < 2000
  ) {
    const expandRaw = await callWithTruncationRetry(
      (maxOutputTokens) =>
        provider.completeStructured({
          model: "smart",
          temperature: 0.35,
          maxOutputTokens,
          schemaName: "profile_overview_expand",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["overview"],
            properties: {
              overview: {
                type: "string",
                description:
                  "Expanded Upwork overview, 2000–3500 characters, same facts, stronger structure.",
              },
            },
          },
          messages: [
            {
              role: "system",
              content: [
                "Expand this Upwork profile overview to 2000–3500 characters.",
                "Keep the same specialty and facts — do not invent clients, companies, countries, or metrics.",
                "PLAIN TEXT only — no **, *, #, or markdown.",
                "First 250 characters must be a strong hook. Short paragraphs; hyphen lists only if needed.",
                "Return JSON only.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Current overview (${normalized.overview.length} chars) — too short:`,
                normalized.overview,
                "",
                "Scraped context (only source of truth):",
                input.profileText.slice(0, 5000),
              ].join("\n"),
            },
          ],
        }),
      4096,
      "profile-overview-expand",
    )
    const expanded = z
      .object({ overview: z.string().min(1500).max(5000) })
      .safeParse(safeJsonParse(expandRaw))
    if (expanded.success) {
      normalized = {
        ...normalized,
        overview: stripProfileMarkdown(expanded.data.overview).trim(),
      }
    }
  }

  return normalized
}
