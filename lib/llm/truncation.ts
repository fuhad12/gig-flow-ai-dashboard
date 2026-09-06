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
 * `callWithTruncationRetry` covers both by retrying once with double
 * the token budget. `safeJsonParse` turns parse failures into a clean,
 * user-facing error message instead of a stack trace.
 *
 * Used by `analyze-gig.ts` and `predict-conversion.ts`. The generate
 * flow goes through `runWithFiverrValidation` which has its own (more
 * elaborate) validation/retry loop.
 */

import { TruncatedResponseError } from "@/lib/llm/providers/types"

/**
 * Call the LLM once at `firstBudget`. If the provider throws
 * `TruncatedResponseError` OR the returned payload isn't syntactically
 * valid JSON, retry once with double the budget. Cap doubles only once
 * so a genuinely runaway model can't drain the user's token quota.
 */
export async function callWithTruncationRetry(
  callOnce: (maxOutputTokens: number) => Promise<string>,
  firstBudget: number,
  /** Optional label for the console.warn so logs are easy to grep. */
  label = "llm",
): Promise<string> {
  try {
    const raw = await callOnce(firstBudget)
    // Cheap pre-validation: if JSON is malformed at this point it's the
    // same failure mode as an explicit truncation — retry it.
    JSON.parse(raw)
    return raw
  } catch (err) {
    const truncated = err instanceof TruncatedResponseError
    const malformed = err instanceof SyntaxError
    if (!truncated && !malformed) throw err
    console.warn(
      `[${label}] first LLM attempt failed (${
        truncated ? "truncated" : "malformed JSON"
      }), retrying with ${firstBudget * 2} tokens`,
    )
    return callOnce(firstBudget * 2)
  }
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
