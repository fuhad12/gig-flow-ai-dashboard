/**
 * Generic "call LLM, validate against Fiverr limits, retry once, truncate as
 * last resort" wrapper used by /api/generate and the analyzer's optimized-copy
 * rewrites.
 *
 * Why a wrapper? Structured-output mode (OpenAI's `json_schema` or Gemini's
 * `responseSchema`) can guarantee the JSON shape but cannot enforce arbitrary
 * char/count rules like Fiverr's. We:
 *   1. Run the call,
 *   2. Validate the parsed result with project-level checks,
 *   3. If any hard-cap was breached OR the keyword target wasn't met, retry
 *      once with explicit fix-it feedback,
 *   4. After the retry, smart-truncate any remaining hard breaches so the
 *      user always gets a usable result,
 *   5. Surface anything we had to fix (or anything still soft-failing like
 *      under-target keyword density) as a `warnings` array so the UI can
 *      show a non-blocking banner.
 *
 * Provider-agnostic: the call goes through `getLlmProvider()` so the same
 * code path works for OpenAI (production) and Gemini (development).
 */

import { getLlmProvider } from "@/lib/llm/provider"
import { TruncatedResponseError } from "@/lib/llm/providers/types"
import type {
  ChatMessage,
  JsonSchema,
  ModelTier,
} from "@/lib/llm/provider"
import {
  countKeywordOccurrences,
  FIVERR,
  formatViolationsForRetry,
  keywordCorpus,
  softTruncate,
  type Violation,
} from "@/lib/fiverr-limits"

export interface FiverrCheckable {
  primaryKeyword: string
  title: string
  description: string
  tags: string[]
  faqs: { question: string; answer: string }[]
  packages?: { name: string; description: string }[]
  requirements?: string[]
}

export interface ValidationOutcome<T> {
  data: T
  warnings: string[]
  /** Number of LLM calls used (1 = first call passed, 2 = retried). */
  callsUsed: number
}

interface RunOptions<T> {
  /** Build the messages for the FIRST call. */
  buildMessages: () => ChatMessage[]
  /** Append the retry feedback to the messages for the SECOND call. */
  buildRetryMessages: (
    base: ChatMessage[],
    feedback: string,
    previousJson: unknown,
  ) => ChatMessage[]
  /** Logical model tier (provider maps to its own model id). */
  model: ModelTier
  temperature: number
  /** JSON schema describing the expected response body. */
  schema: JsonSchema
  /** Optional schema name (OpenAI only — Gemini ignores it). */
  schemaName?: string
  /**
   * Defensive cap on output tokens — see provider docs. Defaults to the
   * provider's built-in cap (4096) if unset, which is enough for any of
   * our current call sites.
   */
  maxOutputTokens?: number
  /** Validate the parsed JSON and return it in domain shape. Throws on parse failure. */
  parse: (raw: string) => T
  /** Extract the Fiverr-checkable surface from the parsed value. */
  toCheckable: (value: T) => FiverrCheckable
  /**
   * Apply soft truncation to the value in-place and return it. Only called
   * if hard-cap violations remain after the retry.
   */
  truncate: (value: T) => T
}

// ---------- Internal: collect every Fiverr violation in one place ----------

function collectViolations(checkable: FiverrCheckable): Violation[] {
  const v: Violation[] = []

  if (checkable.title.length > FIVERR.title.max) {
    v.push({
      field: "title",
      message: `title is ${checkable.title.length} chars (max ${FIVERR.title.max})`,
      severity: "hard",
    })
  }
  if (FIVERR.title.bannedChars.test(checkable.title)) {
    v.push({
      field: "title",
      message: `title contains banned characters (one of: & / | # @ % ")`,
      severity: "hard",
    })
  }
  if (checkable.description.length > FIVERR.description.max) {
    v.push({
      field: "description",
      message: `description is ${checkable.description.length} chars (max ${FIVERR.description.max})`,
      severity: "hard",
    })
  }
  if (checkable.tags.length !== FIVERR.tag.count) {
    v.push({
      field: "tags",
      message: `tags has ${checkable.tags.length} entries (must be exactly ${FIVERR.tag.count})`,
      severity: "hard",
    })
  }
  checkable.tags.forEach((t, i) => {
    if (t.length > FIVERR.tag.max) {
      v.push({
        field: `tags[${i}]`,
        message: `tag "${t}" is ${t.length} chars (max ${FIVERR.tag.max})`,
        severity: "hard",
      })
    }
  })
  checkable.faqs.forEach((f, i) => {
    if (f.question.length > FIVERR.faq.question.max) {
      v.push({
        field: `faqs[${i}].question`,
        message: `FAQ #${i + 1} question is ${f.question.length} chars (max ${FIVERR.faq.question.max})`,
        severity: "hard",
      })
    }
    if (f.answer.length > FIVERR.faq.answer.max) {
      v.push({
        field: `faqs[${i}].answer`,
        message: `FAQ #${i + 1} answer is ${f.answer.length} chars (max ${FIVERR.faq.answer.max})`,
        severity: "hard",
      })
    }
  })
  checkable.packages?.forEach((p, i) => {
    if (p.name.length > FIVERR.package.name.max) {
      v.push({
        field: `packages[${i}].name`,
        message: `package #${i + 1} name is ${p.name.length} chars (max ${FIVERR.package.name.max})`,
        severity: "hard",
      })
    }
    if (p.description.length > FIVERR.package.description.max) {
      v.push({
        field: `packages[${i}].description`,
        message: `package #${i + 1} description is ${p.description.length} chars (max ${FIVERR.package.description.max})`,
        severity: "hard",
      })
    }
  })
  checkable.requirements?.forEach((r, i) => {
    if (r.length > FIVERR.requirement.item.max) {
      v.push({
        field: `requirements[${i}]`,
        message: `requirement #${i + 1} is ${r.length} chars (max ${FIVERR.requirement.item.max})`,
        severity: "hard",
      })
    }
  })

  return v
}

/**
 * Collect soft, non-blocking keyword-placement violations.
 *
 * Each field has BOTH a floor and a ceiling. Falling below the floor
 * means Fiverr's relevance signal is too weak; exceeding the ceiling
 * means the gig reads as keyword-stuffed and the 2026 algorithm will
 * penalise it as spam. Both surface as soft violations — they trigger
 * retry feedback and warnings, but never block delivery.
 *
 * Mirrors the 2026 SEO consensus (`FIVERR.keyword` constants):
 *   - description: 2-4 mentions (~1-2% density on 200-word desc)
 *   - title: 1-2 mentions, naturally
 *   - tags: 1-2 of 5 tags contain the keyword; the rest are long-tail
 */
function keywordViolations(checkable: FiverrCheckable): Violation[] {
  const kw = checkable.primaryKeyword
  const out: Violation[] = []
  const K = FIVERR.keyword

  const descCount = countKeywordOccurrences(
    keywordCorpus({ description: checkable.description }),
    kw,
  )
  if (descCount < K.descMin) {
    out.push({
      field: "primaryKeyword",
      message: `primary keyword "${kw}" appears ${descCount} times in the description (MIN ${K.descMin}). Add ${K.descMin - descCount} natural mention${K.descMin - descCount === 1 ? "" : "s"} — hook (first sentence), body/deliverables, and/or CTA. Do not spam the same phrase every line.`,
      severity: "soft",
    })
  } else if (descCount > K.descMax) {
    out.push({
      field: "primaryKeyword",
      message: `primary keyword "${kw}" appears ${descCount} times in the description (MAX ${K.descMax}). Trim to ${K.descMin}-${K.descMax} exact mentions and replace extras with semantic variants — stuffing hurts ranking and conversion.`,
      severity: "soft",
    })
  }

  const titleCount = countKeywordOccurrences(checkable.title, kw)
  if (titleCount < K.titleMin) {
    out.push({
      field: "title",
      message: `primary keyword "${kw}" appears ${titleCount} times in the title (MIN ${K.titleMin}). Place it once, naturally, near the front.`,
      severity: "soft",
    })
  } else if (titleCount > K.titleMax) {
    out.push({
      field: "title",
      message: `primary keyword "${kw}" appears ${titleCount} times in the title (MAX ${K.titleMax}). Rewrite as a readable outcome title — keyword dumps hurt CTR.`,
      severity: "soft",
    })
  }

  const tagsContaining = checkable.tags.filter(
    (t) => countKeywordOccurrences(t, kw) >= 1,
  ).length
  if (tagsContaining < K.tagMin) {
    out.push({
      field: "tags",
      message: `${tagsContaining}/${FIVERR.tag.count} tags contain the primary keyword "${kw}" (MIN ${K.tagMin}). Anchor relevance with at least one tag.`,
      severity: "soft",
    })
  } else if (tagsContaining > K.tagMax) {
    out.push({
      field: "tags",
      message: `${tagsContaining}/${FIVERR.tag.count} tags contain the primary keyword "${kw}" (MAX ${K.tagMax}). The remaining tag slots should be DIFFERENT long-tail phrases buyers actually search, not repeats of the title.`,
      severity: "soft",
    })
  }

  return out
}

// ---------- Public entry point ----------

export async function runWithFiverrValidation<T>(
  opts: RunOptions<T>,
): Promise<ValidationOutcome<T>> {
  const provider = getLlmProvider()
  const messages = opts.buildMessages()

  let callsUsed = 0
  let parsed: T
  let raw: string

  const callOnce = async (
    msgs: ChatMessage[],
  ): Promise<{ value: T; raw: string }> => {
    callsUsed += 1
    // First pass at the caller's configured budget. If the provider
    // reports the response was cut off mid-JSON (max_tokens hit), retry
    // ONCE with double the budget before bubbling the error up. This is
    // the same recovery pattern used by analyze-gig and predict-conversion
    // — the model occasionally overshoots on rich prompts and a slightly
    // bigger window reliably fixes it.
    const firstBudget = opts.maxOutputTokens
    const callProvider = async (maxOutputTokens: number | undefined) =>
      provider.completeStructured({
        model: opts.model,
        temperature: opts.temperature,
        messages: msgs,
        schema: opts.schema,
        schemaName: opts.schemaName,
        maxOutputTokens,
      })
    let content: string
    try {
      content = await callProvider(firstBudget)
    } catch (err) {
      if (!(err instanceof TruncatedResponseError) || firstBudget == null) {
        throw err
      }
      const bumped = Math.min(firstBudget * 2, 16_384)
      console.warn(
        `[generate] LLM response truncated at ${firstBudget} tokens; retrying with ${bumped}`,
      )
      callsUsed += 1
      try {
        content = await callProvider(bumped)
      } catch (err2) {
        if (!(err2 instanceof TruncatedResponseError) || bumped >= 16_384) {
          throw new Error(
            "The AI response was cut off before it finished. Please try again.",
          )
        }
        const finalBudget = 16_384
        console.warn(
          `[generate] still truncated at ${bumped}; final retry with ${finalBudget}`,
        )
        callsUsed += 1
        content = await callProvider(finalBudget)
      }
    }
    return { value: opts.parse(content), raw: content }
  }

  // First attempt.
  ;({ value: parsed, raw } = await callOnce(messages))

  // Validate.
  let checkable = opts.toCheckable(parsed)
  let hard = collectViolations(checkable)
  const kwIssues = keywordViolations(checkable)
  const allIssues: Violation[] = [...hard, ...kwIssues]

  // Retry once if anything failed.
  if (allIssues.length > 0) {
    const feedback = formatViolationsForRetry(allIssues)
    const retryMsgs = opts.buildRetryMessages(messages, feedback, JSON.parse(raw))
    try {
      ;({ value: parsed } = await callOnce(retryMsgs))
      checkable = opts.toCheckable(parsed)
      hard = collectViolations(checkable)
    } catch {
      // Fall through to truncation with the original `parsed`.
    }
  }

  const warnings: string[] = []

  // Last-resort: smart-truncate any remaining hard breaches so the user
  // ALWAYS gets a usable result (the explicit ask: "must not exceed the max").
  if (hard.length > 0) {
    parsed = opts.truncate(parsed)
    checkable = opts.toCheckable(parsed)
    for (const v of hard) {
      warnings.push(`Auto-trimmed: ${v.message}`)
    }
  }

  // Recompute keyword placement on the final value so the warning we surface
  // matches what the user actually sees.
  for (const v of keywordViolations(checkable)) warnings.push(v.message)

  return { data: parsed, warnings, callsUsed }
}
