/**
 * LLM writer for Upwork proposals.
 *
 * Paste-first: the job text is the source of truth. No Upwork scrape
 * required for the MVP — sellers copy the job post into the form.
 *
 * Also returns a job-fit verdict + red/green flags so sellers can skip
 * bad connects before pasting the cover letter.
 */

import { z } from "zod"

import { UPWORK_WINNING_RULES, FREELANCER_VISIBILITY_RULES } from "@/lib/llm/conversion-playbook"
import { getLlmProvider } from "@/lib/llm/provider"
import { callWithTruncationRetry, safeJsonParse } from "@/lib/llm/truncation"
import type {
  JobFitVerdict,
  JobRedFlag,
  ProposalInput,
  RedFlagSeverity,
  UpworkProposal,
} from "@/lib/proposal-types"
import { cleanQaPairs } from "@/lib/visibility-types"

const RedFlagSchema = z.object({
  code: z.string().min(2).max(64),
  severity: z.enum(["high", "medium", "low"]),
  label: z.string().min(2).max(80),
  detail: z.string().min(8).max(280),
})

const QaSchema = z.object({
  question: z.string().min(8).max(200),
  answer: z.string().min(12).max(600),
})

const ProposalSchema = z.object({
  hook: z.string().min(10).max(280),
  proposal: z.string().min(80).max(4000),
  suggestedBid: z.number().min(5).max(100_000).nullable(),
  winAngles: z.array(z.string()).default([]),
  customizeChecklist: z.array(z.string()).default([]),
  fitScore: z.number().min(0).max(100),
  fitVerdict: z.enum(["strong_apply", "apply_with_caution", "skip"]),
  fitSummary: z.string().min(20).max(400),
  redFlags: z.array(RedFlagSchema).default([]),
  greenFlags: z.array(z.string()).default([]),
  aiRecommendScore: z.number().min(0).max(100).default(50),
  aiRecommendNote: z.string().min(12).max(320).default(""),
  screeningAnswers: z.array(QaSchema).default([]),
})

const DEFAULT_WIN_ANGLES = [
  "Opens on a specific detail from their job post (proves you read it).",
  "Reduces risk with a clear first milestone and Done = acceptance criteria.",
]

const DEFAULT_CHECKLIST = [
  "Add your real name and one portfolio / Loom link before sending.",
  "Replace any placeholder proof with one concrete metric from your work.",
]

const KNOWN_RED_FLAG_CODES = [
  "budget_too_low",
  "unpaid_test",
  "vague_scope",
  "scope_creep",
  "unrealistic_timeline",
  "skill_mismatch",
  "payment_risk",
  "agency_only",
  "already_filled_signal",
  "other",
] as const

function cleanStrings(items: string[], minLen = 5): string[] {
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
    out.push(`Review and personalize item ${out.length + 1} before sending.`)
  }
  return out.slice(0, max)
}

function normalizeCode(raw: string): string {
  const code = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
  if ((KNOWN_RED_FLAG_CODES as readonly string[]).includes(code)) return code
  return code || "other"
}

function normalizeSeverity(raw: string): RedFlagSeverity {
  if (raw === "high" || raw === "medium" || raw === "low") return raw
  return "medium"
}

function normalizeRedFlags(
  flags: z.infer<typeof RedFlagSchema>[],
): JobRedFlag[] {
  const out: JobRedFlag[] = []
  const seen = new Set<string>()
  for (const f of flags.slice(0, 6)) {
    const code = normalizeCode(f.code)
    const key = `${code}:${f.label.trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      code,
      severity: normalizeSeverity(f.severity),
      label: f.label.trim().slice(0, 80),
      detail: f.detail.trim().slice(0, 280),
    })
  }
  return out
}

function deriveVerdict(
  score: number,
  redFlags: JobRedFlag[],
  hinted: JobFitVerdict,
): JobFitVerdict {
  const highCount = redFlags.filter((f) => f.severity === "high").length
  if (highCount >= 2 || score < 35) return "skip"
  if (highCount >= 1 || score < 60) {
    return hinted === "strong_apply" ? "apply_with_caution" : hinted
  }
  if (score >= 75 && highCount === 0) return "strong_apply"
  return hinted
}

function normalizeProposal(
  data: z.infer<typeof ProposalSchema>,
): UpworkProposal {
  const fitScore = Math.max(0, Math.min(100, Math.round(data.fitScore)))
  const redFlags = normalizeRedFlags(data.redFlags)
  const fitVerdict = deriveVerdict(fitScore, redFlags, data.fitVerdict)

  return {
    hook: data.hook.trim(),
    proposal: data.proposal.trim(),
    suggestedBid: data.suggestedBid,
    winAngles: padList(cleanStrings(data.winAngles), DEFAULT_WIN_ANGLES, 2, 5),
    customizeChecklist: padList(
      cleanStrings(data.customizeChecklist),
      DEFAULT_CHECKLIST,
      2,
      6,
    ),
    fitScore,
    fitVerdict,
    fitSummary: data.fitSummary.trim().slice(0, 400),
    redFlags,
    greenFlags: cleanStrings(data.greenFlags, 8).slice(0, 5),
    aiRecommendScore: Math.max(
      0,
      Math.min(100, Math.round(data.aiRecommendScore)),
    ),
    aiRecommendNote:
      data.aiRecommendNote.trim().slice(0, 320) ||
      "Recommendability rises when niche + one concrete proof match the job.",
    screeningAnswers: cleanQaPairs(data.screeningAnswers, 5),
  }
}

export async function writeUpworkProposal(
  input: ProposalInput,
): Promise<UpworkProposal> {
  const provider = getLlmProvider()
  const tone = input.tone ?? "professional"

  const systemPrompt = [
    "You are JobFlow AI, an Upwork proposal coach whose only job is winning interviews AND protecting connects.",
    "You (1) score whether THIS job is worth applying to, (2) list red/green flags, then (3) write a short high-converting proposal.",
    "Return strictly valid JSON matching the schema.",
    "",
    UPWORK_WINNING_RULES,
    "",
    FREELANCER_VISIBILITY_RULES,
    "",
    `Tone: ${tone} — still follow the winning structure above.`,
    "If the job budget is clear, suggest a bid that is competitive but not desperate (slightly under mid when experience is thin; at mid/upper when proof is strong).",
    "If budget is unclear or hourly, set suggestedBid to null.",
    "",
    "JOB FIT (be honest — wasting a connect is worse than a soft skip):",
    "- fitScore 0-100: skill/niche match between THIS freelancer and THIS job.",
    "- fitVerdict: strong_apply | apply_with_caution | skip",
    "  • strong_apply: clear match, sane scope/budget, few risks",
    "  • apply_with_caution: salvageable but has risks — still write a proposal",
    "  • skip: likely unpaid work, extreme mismatch, or toxic signals — still write a short proposal in case they override, but score low",
    "- fitSummary: 1-2 sentences explaining score + verdict for the seller.",
    "- redFlags: 0-6 job risks. Prefer these codes when they fit:",
    `  ${KNOWN_RED_FLAG_CODES.join(", ")}`,
    "  Each flag needs severity (high|medium|low), short label, and detail that cites the job post.",
    "  High severity examples: unpaid test / free sample, budget far below market, payment-outside-Upwork hints, extreme skill mismatch.",
    "- greenFlags: 0-5 positive signals (clear deliverables, realistic budget, skills match, milestone-friendly, etc.).",
    "",
    "AEO / GEO (visibility):",
    "- aiRecommendScore 0-100: would an AI shortlist name THIS freelancer for THIS job given stated niche/skills/proof? Low if vague generalist.",
    "- aiRecommendNote: 1-2 sentences on what would raise recommendability (niche density, one proof line).",
    "- screeningAnswers: 2-3 Q&A pairs. Prefer real screening questions from the job post; else common buyer objections for THIS niche. Answers ≤2 sentences using only freelancer profile facts.",
    "",
    "Keep ALL fields concise — long answers cause failures. proposal stays 120-200 words.",
    "hook field: the first sentence of the proposal only (must contain a job-specific detail).",
    "proposal field: FULL paste-ready cover letter including the hook (120-200 words).",
    "winAngles: ALWAYS return 2-5 short bullets (client benefits).",
    "customizeChecklist: ALWAYS return 2-6 concrete must-edit items before send (never leave empty).",
  ].join("\n")

  const userPrompt = [
    `JOB POST${input.jobUrl ? ` (${input.jobUrl})` : ""}:`,
    "-----",
    input.jobText.slice(0, 6000),
    "-----",
    "",
    "FREELANCER PROFILE (only use facts listed here — do not invent clients or metrics):",
    `Niche: ${input.niche}`,
    `Skills / what I deliver: ${input.skills}`,
    input.tools ? `Tools: ${input.tools}` : null,
    input.experience
      ? `Experience / proof: ${input.experience}`
      : "Experience / proof: (none provided — offer a micro-sample or first-milestone plan; do NOT invent past clients)",
    input.bidHint != null
      ? `Preferred bid range around: $${input.bidHint}`
      : null,
    "",
    "First decide if this job is worth a connect. Then write the proposal most likely to get a reply IF they apply.",
  ]
    .filter(Boolean)
    .join("\n")

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "hook",
      "proposal",
      "suggestedBid",
      "winAngles",
      "customizeChecklist",
      "fitScore",
      "fitVerdict",
      "fitSummary",
      "redFlags",
      "greenFlags",
      "aiRecommendScore",
      "aiRecommendNote",
      "screeningAnswers",
    ],
    properties: {
      hook: {
        type: "string",
        description:
          "First sentence only: two job-specific details that prove the post was read.",
      },
      proposal: {
        type: "string",
        description:
          "Full paste-ready Upwork cover letter (120-200 words): hook → Done= milestone → one proof → choice CTA.",
      },
      suggestedBid: {
        anyOf: [{ type: "number" }, { type: "null" }],
        description: "Suggested bid in USD, or null if unknown.",
      },
      winAngles: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
        description:
          "2-5 client-benefit reasons this angle should win the interview.",
      },
      customizeChecklist: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 6,
        description:
          "2-6 must-edit items before send (portfolio URL, real metric, name).",
      },
      fitScore: {
        type: "number",
        description: "0-100 honest fit between freelancer and job.",
      },
      fitVerdict: {
        type: "string",
        enum: ["strong_apply", "apply_with_caution", "skip"],
        description: "Whether spending a connect is worth it.",
      },
      fitSummary: {
        type: "string",
        description: "1-2 sentences explaining the score and verdict.",
      },
      redFlags: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "severity", "label", "detail"],
          properties: {
            code: {
              type: "string",
              description:
                "Stable key e.g. budget_too_low, unpaid_test, vague_scope.",
            },
            severity: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
            label: { type: "string" },
            detail: {
              type: "string",
              description: "One sentence citing the job post.",
            },
          },
        },
      },
      greenFlags: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
        description: "Positive reasons this job is worth pursuing.",
      },
      aiRecommendScore: {
        type: "number",
        description:
          "0-100: would an AI shortlist recommend this freelancer for this job?",
      },
      aiRecommendNote: {
        type: "string",
        description: "1-2 sentences on recommendability.",
      },
      screeningAnswers: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "answer"],
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
        },
        description:
          "Paste-ready screening Q answers from the job post or niche objections.",
      },
    },
  }

  const raw = await callWithTruncationRetry(
    (maxOutputTokens) =>
      provider.completeStructured({
        model: "smart",
        temperature: 0.35,
        maxOutputTokens,
        schemaName: "upwork_proposal",
        schema,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    4096,
    "upwork-proposal",
  )

  const parsed = ProposalSchema.safeParse(safeJsonParse(raw))
  if (!parsed.success) {
    throw new Error(
      `Proposal model returned invalid JSON: ${parsed.error.message}`,
    )
  }
  return normalizeProposal(parsed.data)
}
