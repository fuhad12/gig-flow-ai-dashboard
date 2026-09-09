/**
 * Upwork proposal writer types.
 */

export interface ProposalInput {
  /** Full job post text (required for paste-first MVP). */
  jobText: string
  /** Optional Upwork job URL for context / display. */
  jobUrl?: string
  /** Freelancer's niche / specialty. */
  niche: string
  /** What the freelancer actually delivers. */
  skills: string
  /** Optional tools / stack. */
  tools?: string
  /** Optional years of experience or proof points. */
  experience?: string
  /** Tone for the proposal. */
  tone?: "professional" | "friendly" | "direct"
  /** Optional max bid hint in USD. */
  bidHint?: number
}

/** Apply / caution / skip — whether this job is worth a connect. */
export type JobFitVerdict = "strong_apply" | "apply_with_caution" | "skip"

export type RedFlagSeverity = "high" | "medium" | "low"

/**
 * Structured risk signal on a job post. Codes stay stable so the UI can
 * icon/group them; `detail` is human-readable and job-specific.
 */
export interface JobRedFlag {
  /** Stable machine key, e.g. `budget_too_low`, `unpaid_test`. */
  code: string
  severity: RedFlagSeverity
  /** Short label for badges ("Budget too low"). */
  label: string
  /** One sentence citing the job post. */
  detail: string
}

export interface UpworkProposal {
  /** Short subject / opening hook (1 sentence). */
  hook: string
  /** Full proposal body ready to paste into Upwork. */
  proposal: string
  /** Suggested bid amount in USD, or null if not enough budget info. */
  suggestedBid: number | null
  /** Why this angle should win (short bullets for the seller). */
  winAngles: string[]
  /** Things the seller should customize before sending. */
  customizeChecklist: string[]
  /** Rough skill/niche fit 0-100 (freelancer ↔ job). */
  fitScore: number
  /** Whether this job is worth spending a connect on. */
  fitVerdict: JobFitVerdict
  /** One–two sentences explaining the score + verdict. */
  fitSummary: string
  /** Client/job risks that can waste connects or unpaid work. */
  redFlags: JobRedFlag[]
  /** Positive signals that make the job worth pursuing. */
  greenFlags: string[]
}

export interface ProposalResponse {
  proposal: UpworkProposal
  cached?: boolean
}
