/**
 * Shared types for the AI Gig Generator.
 *
 * Aligned with Fiverr's actual gig fields and character limits — see
 * `lib/fiverr-limits.ts` for the authoritative constants. The generator
 * guarantees fields fit Fiverr's hard caps; the wrapper retries the LLM and
 * smart-truncates as a last resort.
 */

export interface GenerationPackage {
  tier: "Basic" | "Standard" | "Premium"
  /** Short custom title for the tier (≤ 35 chars). */
  name: string
  /** The 100-char copy that goes into Fiverr's package description field. */
  description: string
  price: number
  deliveryDays: number
  revisions: number
}

export interface GenerationFaq {
  question: string
  answer: string
}

export interface GigGeneration {
  /**
   * The single primary keyword/phrase the gig is targeting. The generator
   * is constrained to weave this into title + description + tags + FAQs
   * roughly `FIVERR.keyword.descMin`–`descMax` times in the description
   * (and once in the title) — natural relevance, not stuffing.
   */
  primaryKeyword: string

  /** Fiverr-paste-ready title (max 80 chars, target 50–59). */
  title: string
  /** Fiverr-paste-ready description (max 1,200 chars, target 900–1,100). */
  description: string
  /** Exactly five search tags (each ≤ 20 chars). */
  tags: string[]
  /**
   * Longer-tail buyer search phrases the seller can weave into the listing.
   * These are NOT a Fiverr field — they're brainstorming output.
   */
  searchKeywords: string[]
  faqs: GenerationFaq[]
  packages: GenerationPackage[]
  /**
   * Buyer requirement prompts that go into Fiverr's "Requirements" step
   * (each ≤ 500 chars, 3–8 items).
   */
  requirements: string[]
  /** 3–5 short concept ideas the seller can brief a designer with. */
  thumbnailIdeas: string[]
  /** A single ready-to-paste prompt for AI image generators. */
  gigImagePrompt: string
  /**
   * Questions buyers ask ChatGPT / Perplexity about this niche —
   * angles the seller can own in FAQs, LinkedIn, or portfolio.
   * Optional for older cached generations.
   */
  buyerAiQuestions?: string[]
  /** SEO → AEO → GEO actions after publishing the gig. */
  visibilityActions?: string[]
}

export interface GenerateRequest {
  niche: string
  skill: string
  tools: string[]
  audience?: string
  experienceLevel?: "beginner" | "intermediate" | "expert"
}

export interface GenerateResponse {
  generation: GigGeneration
  /** Niche slug used for trend context, if any. */
  niche: string
  /**
   * Soft warnings surfaced by the validator (e.g. "primary keyword only
   * appeared 7/10 times", "auto-trimmed description from 1310 to 1200 chars").
   * Empty array on a clean pass.
   */
  warnings: string[]
}
