/**
 * Shared types for every LLM provider implementation.
 *
 * Kept in its own file so `provider.ts` doesn't pull in either SDK at the
 * type level — that way unused providers don't bloat the bundle.
 */

import type { ModelTier } from "@/lib/llm/provider"

export type ChatRole = "system" | "user" | "assistant"

export interface ChatMessage {
  role: ChatRole
  content: string
}

/**
 * A JSON-schema-shaped object describing the expected response. Providers
 * translate this into their own structured-output spec (OpenAI's
 * `response_format.json_schema` / Gemini's `responseSchema`).
 *
 * We intentionally use a loose `Record<string, unknown>` here because the
 * existing schemas already pass through OpenAI's strict-mode quirks (no
 * `maxLength`, no `minItems`, etc.) and we don't want to fight TypeScript
 * about them on every call site. Providers normalize as needed.
 */
export type JsonSchema = Record<string, unknown>

export interface StructuredRequest {
  /** Logical model tier — providers map this to their own model id. */
  model: ModelTier
  temperature: number
  messages: ChatMessage[]
  /** JSON schema for the response body (without name/strict wrappers). */
  schema: JsonSchema
  /**
   * Optional schema "name" — only used by OpenAI strict structured outputs.
   * Gemini ignores it. Defaults to "Response".
   */
  schemaName?: string
  /**
   * Defensive cap on output tokens. Protects against a runaway model
   * (e.g. infinite repetition / very long JSON) burning through budget.
   * Both providers accept this as their respective `max_tokens` /
   * `maxOutputTokens` parameter. If unset, the provider applies a
   * conservative built-in default (see each provider's implementation).
   */
  maxOutputTokens?: number
}

export interface ImageAttachment {
  /** Public URL the model can fetch directly. */
  url: string
  /** OpenAI-specific detail hint. Gemini ignores it. */
  detail?: "low" | "high" | "auto"
}

/**
 * Thrown by a provider when the model stopped before completing its
 * response — typically because `max_tokens` was hit. The raw text is
 * (potentially truncated) JSON the caller can log, but it's NOT safe to
 * `JSON.parse`. Callers should retry with a larger `maxOutputTokens`
 * budget or surface a clean error.
 *
 * Both providers throw this consistently so the call site can use a
 * single retry helper for either backend.
 */
export class TruncatedResponseError extends Error {
  readonly name = "TruncatedResponseError" as const
  /** The provider's reported finish reason ("length", "MAX_TOKENS", etc.). */
  readonly finishReason: string
  /** Whatever partial content the provider returned. May be empty. */
  readonly partial: string
  constructor(finishReason: string, partial: string) {
    super(
      `LLM response was truncated (finish_reason=${finishReason}). The output ran past max_tokens before the JSON closed — retry with a larger budget.`,
    )
    this.finishReason = finishReason
    this.partial = partial
  }
}

export interface MultimodalRequest extends StructuredRequest {
  /** Images to attach to the LAST user message. */
  images: ImageAttachment[]
}

export interface Provider {
  /** Provider identity — useful for logging. */
  readonly name: "openai" | "gemini"

  /**
   * Run a text-only structured-output call. Returns the raw JSON text so
   * callers can parse + Zod-validate it themselves.
   */
  completeStructured(req: StructuredRequest): Promise<string>

  /**
   * Run a multimodal structured-output call. Same return contract as
   * `completeStructured` but the LAST user message also carries images.
   */
  completeMultimodal(req: MultimodalRequest): Promise<string>
}
