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

const OptimizationSchema = z.object({
  score: z.number().min(0).max(100),
  headline: z.string().min(8).max(200),
  overview: z.string().min(80).max(5000),
  skills: z.array(z.string()).default([]),
  winAngles: z.array(z.string()).default([]),
  editChecklist: z.array(z.string()).default([]),
  critique: z.array(z.string()).default([]),
})

const DEFAULT_WIN = [
  "Leads with a clear specialty buyers can scan in under 3 seconds.",
  "Replaces vague bio language with outcome-focused, client-friendly copy.",
]
const DEFAULT_CHECK = [
  "Paste the new headline/title into your live profile and save.",
  "Replace the overview with the rewrite, then add one real proof metric if you have it.",
]
const DEFAULT_CRITIQUE = [
  "Original profile needed clearer positioning for buyers scanning quickly.",
]

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

function normalize(
  platform: ProfilePlatform,
  data: z.infer<typeof OptimizationSchema>,
): ProfileOptimization {
  const score = Math.max(0, Math.min(100, Math.round(data.score)))
  const { verdict, verdictLabel } = verdictFromScore(score)
  return {
    platform,
    score,
    verdict,
    verdictLabel,
    headline: data.headline.trim(),
    overview: data.overview.trim(),
    skills: padList(cleanStrings(data.skills, 2), ["Specialty TBD"], 4, 12),
    winAngles: padList(cleanStrings(data.winAngles), DEFAULT_WIN, 2, 5),
    editChecklist: padList(
      cleanStrings(data.editChecklist),
      DEFAULT_CHECK,
      2,
      8,
    ),
    critique: padList(cleanStrings(data.critique), DEFAULT_CRITIQUE, 2, 6),
  }
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
    `Tone: ${tone}.`,
    "score: honest 0-100 professionalism + conversion readiness of the CURRENT scraped profile (before rewrite).",
    "Be strict: vague hobbies, buzzwords, 'passionate freelancer', or no clear offer should score under 60.",
    "headline: paste-ready title/headline for THIS platform's character limits — keep it tight.",
    "overview: paste-ready about/overview (Fiverr description or Upwork overview). Plain text, short paragraphs.",
    "skills: 4-12 concrete skill labels appropriate to the platform.",
    "critique: 2-6 specific issues in the ORIGINAL text — call out unprofessional or weak phrasing clearly.",
    "editChecklist: 2-8 concrete steps to apply on the live profile.",
    "winAngles: 2-5 why the rewrite helps win clients.",
    "NEVER invent clients, ratings, Job Success %, or earnings not in the scraped text.",
  ].join("\n")

  const userPrompt = [
    `Profile URL: ${input.profileUrl}`,
    `Platform: ${input.platform}`,
    "",
    "SCRAPED PROFILE TEXT (source of truth — rewrite from this):",
    "-----",
    input.profileText.slice(0, 8000),
    "-----",
    "",
    "Score how professional the CURRENT profile is, then produce the optimized package.",
  ].join("\n")

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "score",
      "headline",
      "overview",
      "skills",
      "winAngles",
      "editChecklist",
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
        description: "Paste-ready Fiverr title or Upwork profile headline.",
      },
      overview: {
        type: "string",
        description: "Paste-ready profile overview / about section.",
      },
      skills: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 12,
        description: "Suggested skills / specialties.",
      },
      winAngles: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
      },
      editChecklist: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 8,
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
    4096,
    "profile-optimize",
  )

  const parsed = OptimizationSchema.safeParse(safeJsonParse(raw))
  if (!parsed.success) {
    throw new Error(
      `Profile model returned invalid JSON: ${parsed.error.message}`,
    )
  }
  return normalize(input.platform, parsed.data)
}
