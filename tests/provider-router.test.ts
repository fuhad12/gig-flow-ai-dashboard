/**
 * Tests for the LLM provider router in `lib/llm/provider.ts`.
 *
 * The router decides per request whether `model: "smart"` and `model: "fast"`
 * should go to OpenAI or Gemini. We verify the resolution logic and the
 * per-call dispatch by stubbing out the two concrete provider classes — that
 * keeps the test fast and avoids touching either SDK.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const openaiStructured = vi.fn(async () => JSON.stringify({ provider: "openai-structured" }))
const openaiMultimodal = vi.fn(async () => JSON.stringify({ provider: "openai-multimodal" }))
const geminiStructured = vi.fn(async () => JSON.stringify({ provider: "gemini-structured" }))
const geminiMultimodal = vi.fn(async () => JSON.stringify({ provider: "gemini-multimodal" }))

vi.mock("@/lib/llm/providers/openai-provider", () => ({
  OpenAIProvider: class FakeOpenAI {
    readonly name = "openai" as const
    completeStructured = openaiStructured
    completeMultimodal = openaiMultimodal
  },
}))

vi.mock("@/lib/llm/providers/gemini-provider", () => ({
  GeminiProvider: class FakeGemini {
    readonly name = "gemini" as const
    completeStructured = geminiStructured
    completeMultimodal = geminiMultimodal
  },
}))

import { getLlmProvider, resolveProviderName } from "@/lib/llm/provider"
import type { StructuredRequest } from "@/lib/llm/provider"

const ENV_KEYS = ["LLM_PROVIDER", "LLM_SMART_PROVIDER", "LLM_FAST_PROVIDER"] as const

function clearLlmEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

function baseReq(model: "smart" | "fast"): StructuredRequest {
  return {
    model,
    temperature: 0.2,
    messages: [{ role: "user", content: "hi" }],
    schema: { type: "object" },
  }
}

beforeEach(() => {
  openaiStructured.mockClear()
  openaiMultimodal.mockClear()
  geminiStructured.mockClear()
  geminiMultimodal.mockClear()
  clearLlmEnv()
})

afterEach(() => {
  clearLlmEnv()
})

describe("resolveProviderName", () => {
  it("defaults to openai when nothing is set", () => {
    expect(resolveProviderName("smart")).toBe("openai")
    expect(resolveProviderName("fast")).toBe("openai")
  })

  it("respects LLM_PROVIDER as a global fallback for both tiers", () => {
    process.env.LLM_PROVIDER = "gemini"
    expect(resolveProviderName("smart")).toBe("gemini")
    expect(resolveProviderName("fast")).toBe("gemini")
  })

  it("lets per-tier overrides win over the global setting", () => {
    process.env.LLM_PROVIDER = "gemini"
    process.env.LLM_SMART_PROVIDER = "openai"
    expect(resolveProviderName("smart")).toBe("openai")
    expect(resolveProviderName("fast")).toBe("gemini")
  })

  it("treats blank per-tier overrides as 'use the global default' (not as a typo)", () => {
    process.env.LLM_PROVIDER = "gemini"
    process.env.LLM_FAST_PROVIDER = ""
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveProviderName("fast")).toBe("gemini")
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("falls back to openai for unknown values instead of throwing", () => {
    process.env.LLM_SMART_PROVIDER = "anthropic"
    // We're not in production, so a console.warn is expected — silence it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveProviderName("smart")).toBe("openai")
    warn.mockRestore()
  })

  it("normalizes case and trims whitespace", () => {
    process.env.LLM_SMART_PROVIDER = "  GEMINI "
    expect(resolveProviderName("smart")).toBe("gemini")
  })
})

describe("RouterProvider dispatch", () => {
  it("routes smart requests to OpenAI and fast requests to Gemini when split", async () => {
    process.env.LLM_SMART_PROVIDER = "openai"
    process.env.LLM_FAST_PROVIDER = "gemini"

    const provider = getLlmProvider()
    await provider.completeStructured(baseReq("smart"))
    await provider.completeStructured(baseReq("fast"))

    expect(openaiStructured).toHaveBeenCalledTimes(1)
    expect(geminiStructured).toHaveBeenCalledTimes(1)
  })

  it("sends both tiers to the same backend when only LLM_PROVIDER is set", async () => {
    process.env.LLM_PROVIDER = "gemini"

    const provider = getLlmProvider()
    await provider.completeStructured(baseReq("smart"))
    await provider.completeStructured(baseReq("fast"))

    expect(geminiStructured).toHaveBeenCalledTimes(2)
    expect(openaiStructured).not.toHaveBeenCalled()
  })

  it("only instantiates the backend it actually needs (lazy fast tier)", async () => {
    // Recommended launch config: gpt-4o for the writing the user reads,
    // Gemini Flash for background labels. If the app never calls a fast
    // operation, we should never even import the Gemini SDK.
    process.env.LLM_SMART_PROVIDER = "openai"
    process.env.LLM_FAST_PROVIDER = "gemini"

    const provider = getLlmProvider()
    await provider.completeStructured(baseReq("smart"))
    await provider.completeStructured(baseReq("smart"))

    expect(openaiStructured).toHaveBeenCalledTimes(2)
    expect(geminiStructured).not.toHaveBeenCalled()
  })

  it("dispatches multimodal calls to the same backend as structured calls of that tier", async () => {
    process.env.LLM_SMART_PROVIDER = "gemini"

    const provider = getLlmProvider()
    await provider.completeMultimodal({
      ...baseReq("smart"),
      images: [{ url: "https://example.com/x.jpg" }],
    })

    expect(geminiMultimodal).toHaveBeenCalledTimes(1)
    expect(openaiMultimodal).not.toHaveBeenCalled()
  })

  it("exposes the smart-tier provider name as the router's identity", () => {
    process.env.LLM_SMART_PROVIDER = "gemini"
    process.env.LLM_FAST_PROVIDER = "openai"
    expect(getLlmProvider().name).toBe("gemini")
  })
})
