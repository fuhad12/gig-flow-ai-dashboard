/**
 * Shared resilience helpers for LLM call sites.
 *
 * The structured-output pipeline (`provider.completeStructured` →
 * `JSON.parse(raw)` → Zod schema validation) has two well-known failure
 * modes that aren't really "errors" so much as "the model needed another
 * try":
 *
 *   1. The model hit `max_tokens` before closing the JSON. Both
 *      providers now throw `TruncatedResponseError` so we can detect
 *      this cleanly instead of letting `JSON.parse` blow up downstream
 *      with the cryptic "Unterminated string in JSON at position N".
 *
 *   2. The model returned syntactically broken JSON for some other
 *      reason (rare with strict schema mode, but happens occasionally
 *      with Gemini or when a model emits something weird inside a
 *      string).
 *
 * `callWithTruncationRetry` covers both by escalating the token budget
 * up to twice. `safeJsonParse` turns parse failures into a clean,
 * user-facing error message instead of a stack trace.
 *
 * Used by `analyze-gig.ts` and `predict-conversion.ts`. The generate
 * flow goes through `runWithFiverrValidation` which has its own (more
 * elaborate) validation/retry loop.
 */

import { TruncatedResponseError } from "@/lib/llm/providers/types"

/** Hard ceiling — most chat models allow at least this much output. */
const MAX_OUTPUT_CAP = 16_384

function nextBudget(current: number): number {
  return Math.min(current * 2, MAX_OUTPUT_CAP)
}

function isRetryable(err: unknown): boolean {
  return err instanceof TruncatedResponseError || err instanceof SyntaxError
}

/**
 * Call the LLM at `firstBudget`. On truncation or malformed JSON, retry
 * with a doubled budget (capped). One more escalation if still truncated.
 * Caps retries so a runaway model can't drain the user's token quota.
 */
export async function callWithTruncationRetry(
  callOnce: (maxOutputTokens: number) => Promise<string>,
  firstBudget: number,
  /** Optional label for the console.warn so logs are easy to grep. */
  label = "llm",
): Promise<string> {
  let budget = Math.min(Math.max(firstBudget, 1024), MAX_OUTPUT_CAP)
  let lastErr: unknown

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await callOnce(budget)
      // Cheap pre-validation: if JSON is malformed at this point it's the
      // same failure mode as an explicit truncation — retry it.
      JSON.parse(raw)
      return raw
    } catch (err) {
      lastErr = err
      if (!isRetryable(err) || attempt === 2) break
      const bumped = nextBudget(budget)
      if (bumped <= budget) break
      console.warn(
        `[${label}] attempt ${attempt + 1} failed (${
          err instanceof TruncatedResponseError ? "truncated" : "malformed JSON"
        }), retrying with ${bumped} tokens`,
      )
      budget = bumped
    }
  }

  if (lastErr instanceof TruncatedResponseError) {
    throw new Error(
      "The AI response was cut off before it finished. Please try again — a shorter job post or profile often helps.",
    )
  }
  throw lastErr
}

/**
 * Wrap `JSON.parse` so a truncated response bubbles up as a clear error
 * instead of the cryptic "Unterminated string in JSON at position N".
 * Use AFTER `callWithTruncationRetry` so the retry has already had a
 * shot at recovering — anything that still fails here is a real bug
 * the user should see and report.
 */
export function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `The AI returned a malformed response (${detail}). This is usually a transient issue — try the request again.`,
    )
  }
}
