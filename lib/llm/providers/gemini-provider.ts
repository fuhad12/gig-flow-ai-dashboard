/**
 * Google Gemini provider implementation.
 *
 * Maps the project's logical LLM operations onto Gemini 2.5's generateContent
 * API. Designed to be a drop-in replacement for `OpenAIProvider` so flipping
 * `LLM_PROVIDER=gemini` works without any call-site changes.
 *
 * Key translations vs OpenAI:
 *   1. `system` messages become a single `systemInstruction` on the model,
 *      not a chat turn — Gemini handles them out-of-band.
 *   2. JSON schemas use Gemini's `responseSchema` (a strict subset of
 *      JSON schema). Notably, Gemini does NOT support `additionalProperties`,
 *      `anyOf`, `strict`, or sub-`object` `required` arrays in older versions;
 *      we strip / translate these before submitting.
 *   3. Image URLs are downloaded and re-uploaded as `inlineData` base64,
 *      because Gemini won't fetch arbitrary URLs server-side.
 *   4. Assistant turns map to `role: "model"`.
 *
 * This file is intentionally self-contained so the OpenAI path doesn't pay
 * the cost of importing `@google/generative-ai` when `LLM_PROVIDER=openai`.
 */

import {
  GoogleGenerativeAI,
  type Content,
  type GenerationConfig,
  type Part,
  type Schema,
  SchemaType,
} from "@google/generative-ai"

import type {
  ChatMessage,
  ImageAttachment,
  JsonSchema,
  MultimodalRequest,
  Provider,
  StructuredRequest,
} from "@/lib/llm/providers/types"
import { TruncatedResponseError } from "@/lib/llm/providers/types"
import type { ModelTier } from "@/lib/llm/provider"

const MODEL_BY_TIER: Record<ModelTier, string> = {
  // Latest-generation Gemini Flash for the heavy analytical prompts. It's
  // not gpt-4o quality on long-form critique, but it follows JSON schemas
  // reliably and is free up to 1500 req/day.
  smart: "gemini-2.5-flash",
  // Same model as smart for now — Gemini Flash is already the cheap tier;
  // there's no smaller free model worth using here. If you want to save
  // tokens further, swap this to "gemini-2.5-flash-lite".
  fast: "gemini-2.5-flash-lite",
}

/**
 * Ordered fallbacks when the primary model returns 503 / high-demand.
 * Tried only after the primary model exhausts its capacity retries —
 * different Flash variants often have independent capacity pools, so
 * switching models is more effective than waiting forever on one.
 */
const FALLBACK_MODELS_BY_TIER: Record<ModelTier, string[]> = {
  smart: ["gemini-2.5-flash-lite", "gemini-2.0-flash"],
  fast: ["gemini-2.0-flash-lite", "gemini-2.0-flash"],
}

/** How many times to retry the SAME model on 503/429 before falling back. */
const CAPACITY_RETRIES_PER_MODEL = 2
/** Base delay (ms) for exponential backoff between capacity retries. */
const CAPACITY_RETRY_BASE_MS = 1_200

/**
 * Defensive default when the caller doesn't specify `maxOutputTokens`.
 * Matches the OpenAI default so swapping providers is symmetric.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

export class GeminiProvider implements Provider {
  readonly name = "gemini" as const

  async completeStructured(req: StructuredRequest): Promise<string> {
    const { contents, systemInstruction } = splitMessages(req.messages)
    const generationConfig: GenerationConfig = {
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: translateSchema(req.schema),
    }
    return this.generateWithCapacityFallback(req.model, {
      contents,
      systemInstruction,
      generationConfig,
    })
  }

  async completeMultimodal(req: MultimodalRequest): Promise<string> {
    const { contents, systemInstruction } = splitMessages(req.messages)
    await attachImagesToLastUserTurn(contents, req.images)
    const generationConfig: GenerationConfig = {
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: translateSchema(req.schema),
    }
    return this.generateWithCapacityFallback(req.model, {
      contents,
      systemInstruction,
      generationConfig,
    })
  }

  /**
   * Call Gemini with capacity-aware retries + model fallback.
   *
   * Flow for a `smart` call:
   *   1. Try `gemini-2.5-flash` up to CAPACITY_RETRIES_PER_MODEL + 1 times
   *      with exponential backoff on 503 / 429 / "high demand".
   *   2. If still capacity-bound, try each FALLBACK_MODELS_BY_TIER entry
   *      the same way.
   *   3. If every model is capacity-bound, throw a clear user-facing error
   *      (not the raw Google SDK dump).
   * Non-capacity errors (bad key, schema issues, safety blocks) throw
   * immediately — retrying those is wasted work.
   */
  private async generateWithCapacityFallback(
    tier: ModelTier,
    opts: {
      contents: Content[]
      systemInstruction?: string
      generationConfig: GenerationConfig
    },
  ): Promise<string> {
    const client = this.resolveClient()
    const candidates = [
      MODEL_BY_TIER[tier],
      ...FALLBACK_MODELS_BY_TIER[tier],
    ]
    // De-dupe in case the primary and a fallback resolve to the same id.
    const models = [...new Set(candidates)]

    let lastCapacityError: Error | null = null

    for (const modelId of models) {
      try {
        return await this.generateWithRetries(client, modelId, opts)
      } catch (err) {
        if (!isCapacityError(err)) throw err
        lastCapacityError = err instanceof Error ? err : new Error(String(err))
        console.warn(
          `[gemini] ${modelId} is capacity-bound; trying next model if any`,
        )
      }
    }

    throw new Error(
      "Gemini is temporarily overloaded (high demand on Google's side). " +
        "Wait ~30 seconds and try again, or set LLM_PROVIDER=openai in " +
        ".env.local to use your OpenAI key instead. " +
        `(last error: ${lastCapacityError?.message ?? "503 Service Unavailable"})`,
    )
  }

  private async generateWithRetries(
    client: GoogleGenerativeAI,
    modelId: string,
    opts: {
      contents: Content[]
      systemInstruction?: string
      generationConfig: GenerationConfig
    },
  ): Promise<string> {
    let lastError: unknown
    for (let attempt = 0; attempt <= CAPACITY_RETRIES_PER_MODEL; attempt++) {
      try {
        const model = client.getGenerativeModel({
          model: modelId,
          systemInstruction: opts.systemInstruction,
          generationConfig: opts.generationConfig,
        })
        const result = await model.generateContent({ contents: opts.contents })
        return extractText(result)
      } catch (err) {
        lastError = err
        if (!isCapacityError(err) || attempt === CAPACITY_RETRIES_PER_MODEL) {
          throw err
        }
        const delay =
          CAPACITY_RETRY_BASE_MS * Math.pow(2, attempt) +
          Math.floor(Math.random() * 400)
        console.warn(
          `[gemini] ${modelId} capacity error (attempt ${attempt + 1}/${CAPACITY_RETRIES_PER_MODEL + 1}); retrying in ${delay}ms`,
        )
        await sleep(delay)
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError))
  }

  private resolveClient(): GoogleGenerativeAI {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured. Set it in .env.local or unset LLM_PROVIDER to fall back to OpenAI.",
      )
    }
    return new GoogleGenerativeAI(apiKey)
  }
}

/** True when Google is rate-limiting or capacity-throttling the request. */
function isCapacityError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /\b503\b/.test(msg) ||
    /\b429\b/.test(msg) ||
    /Service Unavailable/i.test(msg) ||
    /high demand/i.test(msg) ||
    /Resource exhausted/i.test(msg) ||
    /try again later/i.test(msg)
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------- Helpers ----------

/**
 * Pull the system message(s) out into a single string Gemini hands to the
 * model as `systemInstruction`, then map the remaining turns into Gemini's
 * `contents` format.
 */
function splitMessages(messages: ChatMessage[]): {
  contents: Content[]
  systemInstruction?: string
} {
  const systemParts: string[] = []
  const contents: Content[] = []
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content)
      continue
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })
  }
  return {
    contents,
    systemInstruction: systemParts.length
      ? systemParts.join("\n\n")
      : undefined,
  }
}

/**
 * Download the images and inline them as base64 on the last user turn.
 *
 * Gemini doesn't fetch arbitrary URLs server-side, so we have to do the
 * fetch ourselves. Each image bumps the request size noticeably; we keep
 * this best-effort and skip images we can't fetch instead of failing the
 * whole call.
 */
async function attachImagesToLastUserTurn(
  contents: Content[],
  images: ImageAttachment[],
): Promise<void> {
  if (images.length === 0) return
  // Find the last user turn (we never attach to a model turn).
  let lastUserIdx = -1
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].role === "user") {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) return

  const parts: Part[] = [...(contents[lastUserIdx].parts ?? [])]
  for (const img of images) {
    try {
      const inline = await fetchAsInlineData(img.url)
      if (inline) parts.push({ inlineData: inline })
    } catch (err) {
      console.warn(
        `[gemini] failed to attach image ${img.url}: ${
          err instanceof Error ? err.message : err
        }`,
      )
    }
  }
  contents[lastUserIdx] = { ...contents[lastUserIdx], parts }
}

async function fetchAsInlineData(
  url: string,
): Promise<{ mimeType: string; data: string } | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim()
  if (!mimeType?.startsWith("image/")) return null
  const buf = Buffer.from(await res.arrayBuffer())
  return { mimeType, data: buf.toString("base64") }
}

function extractText(
  result: Awaited<ReturnType<ReturnType<GoogleGenerativeAI["getGenerativeModel"]>["generateContent"]>>,
): string {
  const text = result.response.text()
  if (!text) {
    throw new Error("Empty response from Gemini")
  }
  // Gemini reports "MAX_TOKENS" when the model bailed out before closing
  // the JSON. Surface a typed error so the analyze/generate/predict
  // wrappers can retry with a bigger budget rather than letting
  // JSON.parse die on a truncated string.
  const candidate = result.response.candidates?.[0]
  const finishReason = candidate?.finishReason as string | undefined
  if (finishReason === "MAX_TOKENS") {
    throw new TruncatedResponseError(finishReason, text)
  }
  return text
}

// ---------- Schema translation ----------

/**
 * Translate our OpenAI-shaped JSON schema into Gemini's `responseSchema`.
 *
 * Mapping rules:
 *   - `type: "object"` -> `SchemaType.OBJECT` + recurse into properties
 *   - `type: "array"`  -> `SchemaType.ARRAY` + recurse into items
 *   - `type: "string"` -> `SchemaType.STRING` (+ enum if present)
 *   - `type: "number"` -> `SchemaType.NUMBER`
 *   - `type: "boolean"` -> `SchemaType.BOOLEAN`
 *   - `anyOf: [X, { type: "null" }]` -> X with `nullable: true`
 *
 * Drops keys Gemini doesn't understand:
 *   - `additionalProperties` (always implicitly false for closed objects)
 *   - `strict`, `name` (those are OpenAI wrapper-level)
 *   - `minimum` / `maximum` on numbers (Gemini doesn't enforce them, but
 *     our Zod validators downstream catch out-of-range values)
 */
function translateSchema(schema: JsonSchema): Schema {
  return translateNode(schema) as Schema
}

function translateNode(node: unknown): Schema {
  if (!node || typeof node !== "object") {
    // Fallback — shouldn't happen with well-formed inputs.
    return { type: SchemaType.STRING } as Schema
  }
  const n = node as Record<string, unknown>

  // Nullable union: `anyOf: [X, { type: "null" }]` -> X with nullable:true.
  if (Array.isArray(n.anyOf)) {
    const variants = n.anyOf as unknown[]
    const nonNull = variants.find(
      (v) => !(typeof v === "object" && v !== null && (v as { type?: unknown }).type === "null"),
    )
    const hasNull = variants.some(
      (v) => typeof v === "object" && v !== null && (v as { type?: unknown }).type === "null",
    )
    if (nonNull && hasNull) {
      const inner = translateNode(nonNull)
      return { ...inner, nullable: true } as Schema
    }
    // Genuine union — Gemini can't represent it. Fall back to string and
    // hope downstream Zod parses the model's best guess.
    return { type: SchemaType.STRING } as Schema
  }

  const t = n.type
  if (t === "object") {
    const properties = (n.properties as Record<string, unknown> | undefined) ?? {}
    const required = (n.required as string[] | undefined) ?? []
    const out: Record<string, Schema> = {}
    for (const [key, value] of Object.entries(properties)) {
      out[key] = translateNode(value)
    }
    const result: Schema = {
      type: SchemaType.OBJECT,
      properties: out,
    } as Schema
    if (required.length > 0) {
      ;(result as Schema & { required?: string[] }).required = required
    }
    if (typeof n.description === "string") {
      ;(result as Schema & { description?: string }).description = n.description
    }
    return result
  }
  if (t === "array") {
    return {
      type: SchemaType.ARRAY,
      items: translateNode(n.items),
    } as Schema
  }
  if (t === "string") {
    const out: Schema = { type: SchemaType.STRING } as Schema
    if (Array.isArray(n.enum)) {
      ;(out as Schema & { enum?: string[] }).enum = n.enum as string[]
      ;(out as Schema & { format?: string }).format = "enum"
    }
    return out
  }
  if (t === "number" || t === "integer") {
    return {
      type: t === "integer" ? SchemaType.INTEGER : SchemaType.NUMBER,
    } as Schema
  }
  if (t === "boolean") {
    return { type: SchemaType.BOOLEAN } as Schema
  }
  return { type: SchemaType.STRING } as Schema
}
