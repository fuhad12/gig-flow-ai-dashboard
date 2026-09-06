/**
 * OpenAI provider implementation.
 *
 * Wraps the existing chat-completions structured-output flow so call sites
 * can stay provider-agnostic. Preserves every observable behavior of the
 * previous direct `getOpenAIClient()` usage:
 *   - strict JSON schema mode (`response_format: json_schema, strict: true`)
 *   - image_url multimodal parts with optional detail hint
 *   - the same gpt-4o / gpt-4o-mini choice via the `ModelTier` mapping
 */

import OpenAI from "openai"

import { getOpenAIClient } from "@/lib/openai"
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
  smart: "gpt-4o",
  fast: "gpt-4o-mini",
}

/**
 * Defensive default when the caller doesn't specify `maxOutputTokens`.
 * Generous enough for the longest legit JSON we produce (full gig
 * generation ~ 3.5k tokens) but small enough that a model going off the
 * rails can't drain the whole context window.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

export class OpenAIProvider implements Provider {
  readonly name = "openai" as const

  async completeStructured(req: StructuredRequest): Promise<string> {
    const client = getOpenAIClient()
    const completion = await client.chat.completions.create({
      model: modelFor(req.model),
      temperature: req.temperature,
      max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      messages: req.messages.map(toOpenAIMessage),
      response_format: buildResponseFormat(req.schema, req.schemaName),
    })
    return readContent(completion)
  }

  async completeMultimodal(req: MultimodalRequest): Promise<string> {
    const client = getOpenAIClient()
    const messages = withImagesOnLastUserTurn(req.messages, req.images)
    const completion = await client.chat.completions.create({
      model: modelFor(req.model),
      temperature: req.temperature,
      max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      messages,
      response_format: buildResponseFormat(req.schema, req.schemaName),
    })
    return readContent(completion)
  }
}

// ---------- Helpers ----------

function modelFor(tier: ModelTier): string {
  return MODEL_BY_TIER[tier]
}

function toOpenAIMessage(
  m: ChatMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  // Cast through the role-specific union because OpenAI's types insist on
  // role-discriminated literals.
  if (m.role === "system") return { role: "system", content: m.content }
  if (m.role === "user") return { role: "user", content: m.content }
  return { role: "assistant", content: m.content }
}

function buildResponseFormat(
  schema: JsonSchema,
  schemaName?: string,
): OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"] {
  return {
    type: "json_schema",
    json_schema: {
      name: schemaName ?? "Response",
      strict: true,
      schema: schema as unknown as Record<string, unknown>,
    },
  }
}

function withImagesOnLastUserTurn(
  messages: ChatMessage[],
  images: ImageAttachment[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  // Find the last user turn — that's the one the images are conceptually
  // attached to.
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i
      break
    }
  }
  messages.forEach((m, idx) => {
    if (idx !== lastUserIdx) {
      out.push(toOpenAIMessage(m))
      return
    }
    const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: m.content },
      ...images.map((img) => ({
        type: "image_url" as const,
        image_url: { url: img.url, detail: img.detail ?? "high" },
      })),
    ]
    out.push({ role: "user", content: parts })
  })
  return out
}

function readContent(completion: OpenAI.Chat.Completions.ChatCompletion): string {
  const choice = completion.choices[0]
  const raw = choice?.message?.content
  if (!raw) {
    throw new Error("Empty response from OpenAI")
  }
  // OpenAI sets finish_reason="length" when the model hit max_tokens before
  // finishing. In strict json_schema mode the partial content is still
  // returned but the JSON is truncated mid-string, which would blow up
  // downstream JSON.parse with "Unterminated string in JSON at position
  // ...". We surface this as a typed error so the call site can retry with
  // a larger budget instead of failing the user's analysis.
  if (choice?.finish_reason === "length") {
    throw new TruncatedResponseError("length", raw)
  }
  return raw
}
