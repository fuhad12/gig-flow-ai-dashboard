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
  /** Rough fit score 0-100. */
  fitScore: number
}

export interface ProposalResponse {
  proposal: UpworkProposal
  cached?: boolean
}
