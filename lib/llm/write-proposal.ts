/**
 * LLM writer for Upwork proposals.
 *
 * Paste-first: the job text is the source of truth. No Upwork scrape
 * required for the MVP — sellers copy the job post into the form.
 */

import { z } from "zod"

import { UPWORK_WINNING_RULES } from "@/lib/llm/conversion-playbook"
import { getLlmProvider } from "@/lib/llm/provider"
import { callWithTruncationRetry, safeJsonParse } from "@/lib/llm/truncation"
import type { ProposalInput, UpworkProposal } from "@/lib/proposal-types"

const ProposalSchema = z.object({
  hook: z.string().min(10).max(280),
  proposal: z.string().min(80).max(4000),
  suggestedBid: z.number().min(5).max(100_000).nullable(),
  winAngles: z.array(z.string()).default([]),
  customizeChecklist: z.array(z.string()).default([]),
  fitScore: z.number().min(0).max(100),
})

const DEFAULT_WIN_ANGLES = [
  "Opens on a specific detail from their job post (proves you read it).",
  "Reduces risk with a clear first milestone and Done = acceptance criteria.",
]

const DEFAULT_CHECKLIST = [
  "Add your real name and one portfolio / Loom link before sending.",
  "Replace any placeholder proof with one concrete metric from your work.",
]

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

function normalizeProposal(
  data: z.infer<typeof ProposalSchema>,
): UpworkProposal {
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
    fitScore: Math.max(0, Math.min(100, Math.round(data.fitScore))),
  }
}

export async function writeUpworkProposal(
  input: ProposalInput,
): Promise<UpworkProposal> {
  const provider = getLlmProvider()
  const tone = input.tone ?? "professional"

  const systemPrompt = [
    "You are JobFlow AI, an Upwork proposal coach whose only job is winning interviews.",
    "You write short, client-friendly, high-converting proposals — never generic AI filler.",
    "Return strictly valid JSON matching the schema.",
    "",
    UPWORK_WINNING_RULES,
    "",
    `Tone: ${tone} — still follow the winning structure above.`,
    "If the job budget is clear, suggest a bid that is competitive but not desperate (slightly under mid when experience is thin; at mid/upper when proof is strong).",
    "If budget is unclear or hourly, set suggestedBid to null.",
    "fitScore: honest 0-100 match between THIS freelancer and THIS job. If fit is weak, still write a tight proposal but score low and put honest gaps in customizeChecklist.",
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
    "Write the proposal most likely to get a reply for THIS job and THIS freelancer.",
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
    },
  }

  const raw = await callWithTruncationRetry(
    (maxOutputTokens) =>
      provider.completeStructured({
        model: "smart",
        temperature: 0.4,
        maxOutputTokens,
        schemaName: "upwork_proposal",
        schema,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    3072,
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
