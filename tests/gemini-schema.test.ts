/**
 * Unit tests for the Gemini JSON-schema translator embedded in
 * `lib/llm/providers/gemini-provider.ts`. We don't ship the translator as a
 * named export — instead we test it by `vi.mock`-ing the SDK and recording
 * what `getGenerativeModel` is asked to enforce as a response schema.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { SchemaType } from "@google/generative-ai"

const generationConfigSpy = vi.fn()
const generateContentSpy = vi.fn(async () => ({
  response: { text: () => JSON.stringify({ ok: true }) },
}))

vi.mock("@google/generative-ai", async () => {
  const actual = await vi.importActual<typeof import("@google/generative-ai")>(
    "@google/generative-ai",
  )
  class FakeGoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(opts: unknown) {
      generationConfigSpy(opts)
      return { generateContent: generateContentSpy }
    }
  }
  return {
    ...actual,
    GoogleGenerativeAI: FakeGoogleGenerativeAI,
  }
})

beforeEach(() => {
  generationConfigSpy.mockClear()
  generateContentSpy.mockClear()
  process.env.GEMINI_API_KEY = "test-key"
})

describe("GeminiProvider schema translation", () => {
  it("translates object/array/enum schemas, drops JSON-Schema noise, and preserves required", async () => {
    const { GeminiProvider } = await import(
      "@/lib/llm/providers/gemini-provider"
    )

    const provider = new GeminiProvider()
    await provider.completeStructured({
      model: "smart",
      temperature: 0.5,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "user" },
      ],
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "number", minimum: 0, maximum: 100 },
          status: { type: "string", enum: ["a", "b"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["score", "status", "tags"],
      },
    })

    expect(generationConfigSpy).toHaveBeenCalledTimes(1)
    const opts = generationConfigSpy.mock.calls[0]![0] as {
      generationConfig: { responseSchema: Record<string, unknown> }
      systemInstruction?: string
    }
    expect(opts.systemInstruction).toBe("sys")
    const schema = opts.generationConfig.responseSchema
    expect(schema.type).toBe(SchemaType.OBJECT)
    expect((schema as { required?: string[] }).required).toEqual([
      "score",
      "status",
      "tags",
    ])

    const props = schema.properties as Record<string, Record<string, unknown>>
    expect(props.score.type).toBe(SchemaType.NUMBER)
    expect(props.status.type).toBe(SchemaType.STRING)
    expect((props.status as { enum?: string[] }).enum).toEqual(["a", "b"])
    expect(props.tags.type).toBe(SchemaType.ARRAY)
    expect((props.tags.items as { type: unknown }).type).toBe(SchemaType.STRING)
    // Should NOT carry over OpenAI-only noise.
    expect("additionalProperties" in schema).toBe(false)
  })

  it("turns anyOf: [X, { type: 'null' }] into a nullable X", async () => {
    const { GeminiProvider } = await import(
      "@/lib/llm/providers/gemini-provider"
    )

    const provider = new GeminiProvider()
    await provider.completeStructured({
      model: "fast",
      temperature: 0,
      messages: [{ role: "user", content: "go" }],
      schema: {
        type: "object",
        properties: {
          intent: {
            anyOf: [
              { type: "string", enum: ["a", "b"] },
              { type: "null" },
            ],
          },
        },
        required: ["intent"],
      },
    })

    const opts = generationConfigSpy.mock.calls[0]![0] as {
      generationConfig: { responseSchema: Record<string, unknown> }
    }
    const intent = (opts.generationConfig.responseSchema.properties as Record<
      string,
      Record<string, unknown>
    >).intent
    expect(intent.type).toBe(SchemaType.STRING)
    expect(intent.nullable).toBe(true)
    expect((intent as { enum?: string[] }).enum).toEqual(["a", "b"])
  })
})
