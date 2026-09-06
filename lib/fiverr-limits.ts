/**
 * Single source of truth for Fiverr's gig-field character limits and
 * structural rules.
 *
 * Used by:
 * - LLM prompts (constraint statements baked into system messages)
 * - Zod schemas on /api/generate and /api/analyze (validation)
 * - The retry/truncate guard (`lib/llm/with-fiverr-validation.ts`)
 * - Live UI character counters (generator + auditor)
 *
 * Provenance tags on each field:
 *   VERIFIED  -> documented in Fiverr Help Center / 2026 seller docs
 *   LIKELY    -> not officially documented; matches Fiverr's UI input cap
 *                or community consensus. Safe defaults that can be tuned
 *                without code refactors.
 */

export const FIVERR = {
  title: {
    max: 80, // VERIFIED
    optimalMin: 50, // VERIFIED (full display in search before truncation)
    optimalMax: 59, // VERIFIED
    // Fiverr blocks these in titles. See help center "Creating a Gig".
    bannedChars: /[&\/\|#@%"]/,
  },
  description: {
    max: 1200, // VERIFIED
    optimalMin: 900, // VERIFIED
    optimalMax: 1100, // VERIFIED
  },
  tag: {
    max: 20, // VERIFIED
    count: 5, // VERIFIED (exactly 5)
    // Lowercase letters, numbers, spaces, hyphens.
    allowed: /^[a-z0-9 -]+$/,
  },
  package: {
    name: { max: 35 }, // LIKELY (matches Fiverr UI input cap)
    description: { max: 100 }, // VERIFIED
    revisions: { min: 0, max: 20 },
    deliveryDays: { min: 1, max: 60 },
  },
  faq: {
    question: { max: 150 }, // LIKELY
    answer: { max: 500 }, // VERIFIED
    count: { min: 3, max: 10 }, // VERIFIED (Fiverr allows up to 10 FAQs)
  },
  requirement: {
    item: { max: 500 }, // LIKELY
    count: { min: 3, max: 8 }, // LIKELY
  },
  keyword: {
    // Density calibration — aligned to 2026 public Fiverr SEO consensus
    // (Fiverr Help Center + seller guides): relevance without stuffing.
    //
    // Description: primary keyword 2–4× in a typical 150–250 word listing
    // (open + middle + CTA). ≥7× in that length is widely treated as a
    // spam / soft-suppression risk and tanks conversion.
    //
    // Title: 1 strong placement (readable outcome title). Multiple
    // pipe-separated keyword dumps hurt CTR.
    //
    // Tags: 1–2 slots with the primary keyword; remaining slots are
    // different long-tail buyer queries from autocomplete.
    //
    // Both floor and ceiling are SOFT — they trigger retry feedback
    // and surface as warnings, but never block delivery.

    /** Description: minimum primary-keyword occurrences. */
    descMin: 3,
    /**
     * Description: maximum before it starts reading like spam.
     * Research sweet spot is 2–4; we allow up to 4 exact matches.
     */
    descMax: 4,

    /**
     * Title: minimum primary-keyword occurrences (1 readable placement).
     */
    titleMin: 1,
    /**
     * Title: ceiling — a second mention is OK if natural; more reads as
     * a keyword dump inside the 80-char cap.
     */
    titleMax: 2,

    /** Tags: at least one tag should anchor the primary keyword. */
    tagMin: 1,
    /**
     * Tags: cap the primary keyword to two tags. The remaining 3-4
     * tag slots should be DIFFERENT long-tail phrases so the gig
     * matches a wider set of buyer queries (per 2026 SEO guidance).
     */
    tagMax: 2,

    /**
     * Optional list of semantic variants the validator/prompts use
     * to encourage natural-sounding topical coverage without exact
     * duplication. Example: for primary "ai app" → ["ai application",
     * "ai tool", "intelligent app"].
     */
    semanticVariantsRecommended: 5,

    /** @deprecated Use `descMin`. Kept for one release for safety. */
    targetOccurrences: 3,
    /** @deprecated Use `tagMin`. Kept for one release for safety. */
    minTagsContaining: 1,
  },
} as const

// ---------- Helpers ----------

export interface FieldRange {
  /** Character count of the value. */
  length: number
  /** Hard cap that must not be exceeded. */
  max: number
  /** Optional optimal floor (for UI hinting only). */
  optimalMin?: number
  /** Optional optimal ceiling (for UI hinting only). */
  optimalMax?: number
}

/** Classify a value's length for UI coloring. */
export type LengthTone = "empty" | "under" | "optimal" | "over-optimal" | "over-max"

export function classifyLength(range: FieldRange): LengthTone {
  if (range.length === 0) return "empty"
  if (range.length > range.max) return "over-max"
  if (range.optimalMax != null && range.length > range.optimalMax) {
    return "over-optimal"
  }
  if (range.optimalMin != null && range.length < range.optimalMin) {
    return "under"
  }
  return "optimal"
}

/**
 * Smart-truncate a string to `max` characters. Tries to cut on the last
 * sentence boundary, then the last word boundary, before falling back to a
 * hard slice. Adds an ellipsis if a cut actually happened.
 */
export function softTruncate(input: string, max: number): string {
  if (input.length <= max) return input
  const slice = input.slice(0, max)
  // Prefer cutting at end of sentence within the slice.
  const sentenceCut = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("\n"),
  )
  if (sentenceCut > max * 0.5) {
    return slice.slice(0, sentenceCut + 1).trimEnd()
  }
  // Fall back to last whitespace.
  const wordCut = slice.lastIndexOf(" ")
  if (wordCut > max * 0.5) {
    // Leave room for an ellipsis (1 char) if we have it.
    const withEllipsis = slice.slice(0, wordCut).trimEnd()
    return withEllipsis.length + 1 <= max ? `${withEllipsis}…` : withEllipsis
  }
  // Hard slice as last resort.
  return slice.trimEnd()
}

// ---------- Field-level validators ----------

export interface Violation {
  field: string
  message: string
  /** Whether this is a hard-cap breach (must fix) vs an optimal-range miss. */
  severity: "hard" | "soft"
}

export function checkTitle(value: string): Violation[] {
  const v: Violation[] = []
  if (value.length > FIVERR.title.max) {
    v.push({
      field: "title",
      message: `title is ${value.length} chars (max ${FIVERR.title.max})`,
      severity: "hard",
    })
  }
  if (FIVERR.title.bannedChars.test(value)) {
    v.push({
      field: "title",
      message: `title contains banned characters (${FIVERR.title.bannedChars})`,
      severity: "hard",
    })
  }
  return v
}

export function checkDescription(value: string): Violation[] {
  const v: Violation[] = []
  if (value.length > FIVERR.description.max) {
    v.push({
      field: "description",
      message: `description is ${value.length} chars (max ${FIVERR.description.max})`,
      severity: "hard",
    })
  }
  return v
}

export function checkTags(tags: string[]): Violation[] {
  const v: Violation[] = []
  if (tags.length !== FIVERR.tag.count) {
    v.push({
      field: "tags",
      message: `tags has ${tags.length} entries (Fiverr requires exactly ${FIVERR.tag.count})`,
      severity: "hard",
    })
  }
  tags.forEach((t, i) => {
    if (t.length > FIVERR.tag.max) {
      v.push({
        field: `tags[${i}]`,
        message: `tag "${t}" is ${t.length} chars (max ${FIVERR.tag.max})`,
        severity: "hard",
      })
    }
  })
  return v
}

export function checkFaq(
  faqs: { question: string; answer: string }[],
): Violation[] {
  const v: Violation[] = []
  faqs.forEach((f, i) => {
    if (f.question.length > FIVERR.faq.question.max) {
      v.push({
        field: `faqs[${i}].question`,
        message: `FAQ question is ${f.question.length} chars (max ${FIVERR.faq.question.max})`,
        severity: "hard",
      })
    }
    if (f.answer.length > FIVERR.faq.answer.max) {
      v.push({
        field: `faqs[${i}].answer`,
        message: `FAQ answer is ${f.answer.length} chars (max ${FIVERR.faq.answer.max})`,
        severity: "hard",
      })
    }
  })
  return v
}

export function checkPackages(
  packages: { name: string; description: string }[],
): Violation[] {
  const v: Violation[] = []
  packages.forEach((p, i) => {
    if (p.name.length > FIVERR.package.name.max) {
      v.push({
        field: `packages[${i}].name`,
        message: `package name is ${p.name.length} chars (max ${FIVERR.package.name.max})`,
        severity: "hard",
      })
    }
    if (p.description.length > FIVERR.package.description.max) {
      v.push({
        field: `packages[${i}].description`,
        message: `package description is ${p.description.length} chars (max ${FIVERR.package.description.max})`,
        severity: "hard",
      })
    }
  })
  return v
}

export function checkRequirements(items: string[]): Violation[] {
  const v: Violation[] = []
  items.forEach((r, i) => {
    if (r.length > FIVERR.requirement.item.max) {
      v.push({
        field: `requirements[${i}]`,
        message: `requirement is ${r.length} chars (max ${FIVERR.requirement.item.max})`,
        severity: "hard",
      })
    }
  })
  return v
}

// ---------- Keyword density ----------

/**
 * Count case-insensitive, word-boundary-aware occurrences of `keyword` in
 * `haystack`. Multi-word keywords are matched as a phrase (not as individual
 * words), so "next.js saas" counts as one hit per occurrence — not per token.
 */
export function countKeywordOccurrences(
  haystack: string,
  keyword: string,
): number {
  if (!keyword.trim()) return 0
  // Escape regex special chars in the keyword.
  const escaped = keyword
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Word boundary BEFORE only if the keyword starts with a word char.
  // Word boundary AFTER only if the keyword ends with a word char.
  const startsWordy = /^\w/.test(keyword)
  const endsWordy = /\w$/.test(keyword[keyword.length - 1] ?? "")
  const pre = startsWordy ? "\\b" : ""
  const post = endsWordy ? "\\b" : ""
  const re = new RegExp(`${pre}${escaped}${post}`, "gi")
  const matches = haystack.match(re)
  return matches?.length ?? 0
}

/**
 * Where we measure primary-keyword density. We only count the description
 * because that's the field the seller has room to weave a keyword into
 * naturally, and it's the field Fiverr's search algorithm indexes most
 * heavily for body text. Title/tags/FAQ get a single, well-placed mention
 * — anything more reads as stuffing.
 */
export function keywordCorpus(parts: { description: string }): string {
  return parts.description
}

// ---------- Aggregate violation rendering ----------

/** Format a violation list as a bullet block the LLM can act on in a retry. */
export function formatViolationsForRetry(violations: Violation[]): string {
  if (violations.length === 0) return ""
  const lines = violations.map((v) => `- ${v.message}`)
  return [
    "Your previous response violated these Fiverr field constraints. Fix every one and return the corrected JSON:",
    ...lines,
  ].join("\n")
}
