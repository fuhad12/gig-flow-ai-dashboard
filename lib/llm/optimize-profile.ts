/**
 * LLM optimizer for Fiverr / Upwork seller profiles.
 * URL-first: scrapes public profile text, then rewrites + scores professionalism.
 */

import { z } from "zod"

import {
  FIVERR_PROFILE_RULES,
  UPWORK_PROFILE_RULES,
} from "@/lib/llm/conversion-playbook"
import { getLlmProvider } from "@/lib/llm/provider"
import { callWithTruncationRetry, safeJsonParse } from "@/lib/llm/truncation"
import type {
  ProfileOptimizeInput,
  ProfileOptimization,
  ProfilePlatform,
} from "@/lib/profile-optimizer-types"
import { verdictFromScore } from "@/lib/profile-optimizer-types"

const ActionStepSchema = z.object({
  title: z.string().min(4).max(120),
  detail: z.string().min(12).max(500),
})

const OptimizationSchema = z.object({
  score: z.number().min(0).max(100),
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
})

const DEFAULT_WIN = [
  "Leads with a clear specialty buyers can scan in under 3 seconds.",
  "Replaces vague bio language with outcome-focused, client-friendly copy.",
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
): Array<{ title: string; detail: string }> {
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
  for (const step of [...fromLegacy, ...DEFAULT_ACTION]) {
    if (merged.length >= 4) break
    if (!merged.some((m) => m.title === step.title)) merged.push(step)
  }
  while (merged.length < 4) {
    merged.push(DEFAULT_ACTION[merged.length % DEFAULT_ACTION.length])
  }
  return merged.slice(0, 8)
}

function rateLabel(platform: ProfilePlatform): string {
  return platform === "upwork"
    ? "Suggested hourly rate"
    : "Suggested starting price"
}

function normalize(
  platform: ProfilePlatform,
  data: z.infer<typeof OptimizationSchema>,
): ProfileOptimization {
  const score = Math.max(0, Math.min(100, Math.round(data.score)))
  const { verdict, verdictLabel } = verdictFromScore(score)
  const actionPlan = normalizeActionPlan(data.actionPlan, data.editChecklist)
  const rate =
    data.suggestedRateUsd != null && Number.isFinite(data.suggestedRateUsd)
      ? Math.round(data.suggestedRateUsd)
      : null

  return {
    platform,
    score,
    verdict,
    verdictLabel,
    headline: stripProfileMarkdown(data.headline.trim()),
    overview: stripProfileMarkdown(data.overview.trim()).replace(/\*/g, ""),
    skills: padList(cleanStrings(data.skills, 2), ["Specialty TBD"], 4, 15),
    suggestedRateUsd: rate,
    suggestedRateLabel: rateLabel(platform),
    suggestedRateNote:
      data.suggestedRateNote.trim() ||
      (platform === "upwork"
        ? "Positioning rate for your profile — you can still bid higher or lower per job."
        : "Suggested entry package price; adjust packages to match deliverables."),
    winAngles: padList(cleanStrings(data.winAngles), DEFAULT_WIN, 2, 5),
    actionPlan,
    editChecklist: actionPlan.map(
      (s, i) => `${i + 1}. ${s.title}: ${s.detail}`,
    ),
    critique: padList(cleanStrings(data.critique), DEFAULT_CRITIQUE, 2, 6),
  }
}

function platformOverviewInstructions(platform: ProfilePlatform): string {
  if (platform === "upwork") {
    return [
      "UPWORK OVERVIEW LENGTH (critical):",
      "- Hard max 5,000 characters. TARGET 2,000–3,500 characters (count characters, not words).",
      "- First 200–250 characters must be a strong hook (visible before Read more).",
      "- PLAIN TEXT only — no **, *, #, backticks, or markdown links.",
      "- Short paragraphs with blank lines. Prefer prose. Hyphen lists ('- item') only if needed — never asterisks.",
      "UPWORK TITLE: max 70 characters.",
      "suggestedRateUsd: recommended profile hourly rate in USD (number), or null only if impossible to infer.",
      "TRUTH: Only name clients/people/companies listed under Named clients / work history in the scrape. If none, write without naming clients.",
    ].join("\n")
  }
  return [
    "FIVERR DESCRIPTION: buyer-first, scannable, ~400–1,200 characters unless more proof is available.",
    "PLAIN TEXT only — no markdown asterisks.",
    "suggestedRateUsd: suggested starting package price in USD when inferable, else null.",
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

  const systemPrompt = [
    "You are JobFlow AI, a freelance profile coach for Fiverr and Upwork.",
    "You rewrite seller profiles to look professional, specific, and client-friendly — never generic AI filler.",
    "Return strictly valid JSON matching the schema.",
    "",
    `PLATFORM: ${input.platform.toUpperCase()}`,
    platformRules,
    "",
    platformOverviewInstructions(input.platform),
    "",
    `Tone: ${tone}.`,
    "score: honest 0-100 professionalism + conversion readiness of the CURRENT scraped profile (before rewrite).",
    "Be strict: vague hobbies, buzzwords, 'passionate freelancer', or no clear offer should score under 60.",
    "headline: paste-ready title/headline for THIS platform's character limits — keep it tight. No markdown.",
    "overview: paste-ready about/overview. PLAIN TEXT only (no ** or * markdown). Short paragraphs.",
    "skills: 4-15 concrete skill labels appropriate to the platform — prefer skills already present.",
    "critique: 2-6 specific issues in the ORIGINAL text — call out unprofessional or weak phrasing clearly.",
    "actionPlan: 5-7 ordered steps. Each has title (what to do) + detail (exactly how on the live profile).",
    "  Must cover: headline, overview paste, rate/pricing, skills, and one proof/portfolio step when relevant.",
    "suggestedRateNote: one sentence explaining the rate choice without inventing credentials.",
    "winAngles: 2-5 why the rewrite helps win clients.",
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
      ? "Produce a full Upwork package: 70-char headline, 2000–3500 character PLAIN-TEXT overview (no asterisks), suggested hourly rate, skills, critique, win angles, and a clear numbered action plan. Cite only clients/people explicitly listed above."
      : "Score the CURRENT profile, then produce an optimized package with a clear action plan. Plain text only. Never invent clients.",
  ].join("\n")

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "score",
      "headline",
      "overview",
      "skills",
      "suggestedRateUsd",
      "suggestedRateNote",
      "winAngles",
      "actionPlan",
      "critique",
    ],
    properties: {
      score: {
        type: "number",
        description:
          "0-100 professionalism score of the current scraped profile.",
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
          "Upwork hourly USD or Fiverr starting package USD; null if unknown.",
      },
      suggestedRateNote: {
        type: "string",
        description: "One sentence justifying the suggested rate.",
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
    8192,
    "profile-optimize",
  )

  const parsed = OptimizationSchema.safeParse(safeJsonParse(raw))
  if (!parsed.success) {
    throw new Error(
      `Profile model returned invalid JSON: ${parsed.error.message}`,
    )
  }

  let normalized = normalize(input.platform, parsed.data)

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
