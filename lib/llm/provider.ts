/**
 * LLM provider abstraction.
 *
 * Every LLM call in the project goes through this interface so the underlying
 * provider (OpenAI / Gemini) can be swapped without touching call sites.
 *
 * Two levels of control:
 *
 *   1. Single-provider mode (simplest)
 *      `LLM_PROVIDER=gemini`   — everything goes to Gemini
 *      `LLM_PROVIDER=openai`   — everything goes to OpenAI (default)
 *
 *   2. Hybrid mode (recommended for launch)
 *      Override one or both tiers independently:
 *        `LLM_SMART_PROVIDER=openai`   — analyze, predict, generate, insights
 *        `LLM_FAST_PROVIDER=gemini`    — keyword enrichment (the only "fast"
 *                                        call site today)
 *      Anything not set falls back to `LLM_PROVIDER`, then to `openai`.
 *
 * Two operations cover every current call site:
 *
 *   1. `completeStructured` — system prompt + user prompt + JSON schema +
 *      multi-turn message history. Returns raw JSON text (callers parse +
 *      Zod-validate themselves so the wrapper logic in
 *      `with-fiverr-validation.ts` stays provider-agnostic).
 *
 *   2. `completeMultimodal` — same shape plus one or more image URLs
 *      attached to the user turn. Used by the analyzer's thumbnail vision
 *      pass.
 *
 * Each request carries a `model: ModelTier` field. The router below uses
 * that to pick the right backing provider at call time.
 *
 * Implementations live in `lib/llm/providers/`.
 */

import type {
  MultimodalRequest,
  Provider,
  StructuredRequest,
} from "@/lib/llm/providers/types"

import { OpenAIProvider } from "@/lib/llm/providers/openai-provider"
import { GeminiProvider } from "@/lib/llm/providers/gemini-provider"

export type LlmProviderName = "openai" | "gemini"

/**
 * Logical model tiers. Each provider maps these to its own model IDs so
 * call sites never hard-code provider-specific names.
 *
 *   - "smart": best-quality model for analytical writing
 *              (gpt-4o on OpenAI / gemini-2.5-flash on Gemini)
 *   - "fast":  cheap/fast model for short summaries + enrichment
 *              (gpt-4o-mini on OpenAI / gemini-2.5-flash-lite on Gemini)
 */
export type ModelTier = "smart" | "fast"

export type {
  Provider,
  ChatMessage,
  StructuredRequest,
  MultimodalRequest,
  ImageAttachment,
  JsonSchema,
} from "@/lib/llm/providers/types"

// ---------- Resolution ----------

/**
 * Resolve the provider name for a given tier from environment.
 *
 * Resolution order:
 *   1. Per-tier override (`LLM_SMART_PROVIDER` / `LLM_FAST_PROVIDER`)
 *   2. Global override (`LLM_PROVIDER`)
 *   3. Default: `openai`
 *
 * Unknown values fall back to `openai` rather than throwing, so a typo in
 * Vercel doesn't take the whole app down.
 */
export function resolveProviderName(tier: ModelTier): LlmProviderName {
  const perTier =
    tier === "smart"
      ? process.env.LLM_SMART_PROVIDER
      : process.env.LLM_FAST_PROVIDER
  // Treat empty string the same as unset — `.env` files commonly leave the
  // value blank (`LLM_FAST_PROVIDER=`) and we don't want that to log an
  // "unknown provider" warning.
  const candidates = [perTier, process.env.LLM_PROVIDER]
  const picked = candidates.find((v) => v != null && v.trim() !== "") ?? "openai"
  const raw = picked.trim().toLowerCase()
  if (raw === "gemini") return "gemini"
  if (raw === "openai") return "openai"
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `[llm] Unknown provider name "${raw}" for tier "${tier}", defaulting to openai.`,
    )
  }
  return "openai"
}

function createSingleProvider(name: LlmProviderName): Provider {
  if (name === "gemini") return new GeminiProvider()
  return new OpenAIProvider()
}

// ---------- Router ----------

/**
 * Dispatches each request to a different underlying provider based on the
 * request's `model` tier. Lazy: only instantiates the providers it actually
 * needs (and only once per request lifetime).
 *
 * The router's own `.name` reports whichever provider handles the SMART tier,
 * since that's the user-visible "main" model and what logs/dashboards most
 * care about. Callers that need precise per-tier identity can call
 * `resolveProviderName(tier)` directly.
 */
class RouterProvider implements Provider {
  private smart: Provider | null = null
  private fast: Provider | null = null

  get name(): Provider["name"] {
    return resolveProviderName("smart")
  }

  completeStructured(req: StructuredRequest): Promise<string> {
    return this.providerFor(req.model).completeStructured(req)
  }

  completeMultimodal(req: MultimodalRequest): Promise<string> {
    return this.providerFor(req.model).completeMultimodal(req)
  }

  private providerFor(tier: ModelTier): Provider {
    if (tier === "smart") {
      if (!this.smart) this.smart = createSingleProvider(resolveProviderName("smart"))
      return this.smart
    }
    if (!this.fast) this.fast = createSingleProvider(resolveProviderName("fast"))
    return this.fast
  }
}

/**
 * Returns the active provider. If `LLM_SMART_PROVIDER` and `LLM_FAST_PROVIDER`
 * resolve to the same backend (which is the common case), the router still
 * works — it just instantiates a single underlying provider lazily.
 *
 * Note: providers throw on missing API keys at FIRST USE, not at construction.
 * That means flipping `LLM_FAST_PROVIDER=gemini` without setting
 * `GEMINI_API_KEY` won't break smart-tier calls; only the first fast-tier
 * call (keyword enrichment) will surface the misconfiguration.
 */
export function getLlmProvider(): Provider {
  return new RouterProvider()
}
