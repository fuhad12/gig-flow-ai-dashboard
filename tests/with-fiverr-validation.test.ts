import { describe, it, expect, vi, beforeEach } from "vitest"

import {
  runWithFiverrValidation,
  type FiverrCheckable,
} from "@/lib/llm/with-fiverr-validation"
import type { ChatMessage } from "@/lib/llm/provider"
import { FIVERR, softTruncate } from "@/lib/fiverr-limits"

// ---------- Mock the LLM provider used by the validator ----------
//
// `runWithFiverrValidation` calls `getLlmProvider()` from `@/lib/llm/provider`,
// which would otherwise instantiate a real OpenAI or Gemini client. We replace
// it with a programmable fake whose queued responses each test pre-loads. This
// lets us assert how many times the wrapper calls the model and what feedback
// it sent on the retry pass.

interface QueuedResponse {
  content: string
}
const responseQueue: QueuedResponse[] = []
const seenMessages: ChatMessage[][] = []

vi.mock("@/lib/llm/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm/provider")>(
    "@/lib/llm/provider",
  )
  return {
    ...actual,
    getLlmProvider: () => ({
      name: "openai" as const,
      completeStructured: vi.fn(
        async (req: { messages: ChatMessage[] }): Promise<string> => {
          seenMessages.push(req.messages)
          const next = responseQueue.shift()
          if (!next) {
            throw new Error("No queued response — test setup bug")
          }
          return next.content
        },
      ),
      completeMultimodal: vi.fn(),
    }),
  }
})

beforeEach(() => {
  responseQueue.length = 0
  seenMessages.length = 0
})

// ---------- Test scaffold ----------

type Shape = FiverrCheckable

// Engineered to land inside the 2026 balanced ranges:
//   description: 3 mentions (range 3-4)
//   title:       1 mention  (range 1-2)
//   tags:        1 containing (range 1-2)
const baseValid: Shape = {
  primaryKeyword: "cursor",
  title: "I will build a cursor SaaS MVP that ships in a week",
  description:
    "Need a production-ready cursor app for your idea? I build clean MVPs with auth, database, and payments wired in from day one. You'll get a polished frontend, stable backend, and clear docs at handoff. Order your cursor build today — send your brief and I'll confirm scope within a few hours so your cursor project stays on track.",
  tags: ["cursor saas", "react developer", "nextjs mvp", "fast delivery", "saas builder"],
  faqs: [
    { question: "How long does it take?", answer: "Usually about a week." },
    { question: "Do you offer revisions?", answer: "Yes, two free." },
  ],
  packages: [
    { name: "Basic", description: "A simple MVP." },
    { name: "Standard", description: "MVP with auth + db." },
  ],
  requirements: ["What is your goal?", "Share any branding"],
}

function asResponse(value: Shape): string {
  return JSON.stringify(value)
}

function makeOpts(initial: Shape, retry?: Shape) {
  responseQueue.push({ content: asResponse(initial) })
  if (retry) responseQueue.push({ content: asResponse(retry) })

  return {
    buildMessages: (): ChatMessage[] => [
      { role: "system" as const, content: "system prompt" },
      { role: "user" as const, content: "user prompt" },
    ],
    buildRetryMessages: (
      base: ChatMessage[],
      feedback: string,
    ): ChatMessage[] => [
      ...base,
      { role: "user" as const, content: feedback },
    ],
    model: "smart" as const,
    temperature: 0.5,
    schema: { type: "object" } as Record<string, unknown>,
    parse: (raw: string) => JSON.parse(raw) as Shape,
    toCheckable: (value: Shape) => value,
    truncate: (value: Shape): Shape => ({
      ...value,
      title: softTruncate(value.title, FIVERR.title.max),
      description: softTruncate(value.description, FIVERR.description.max),
      tags: value.tags
        .slice(0, FIVERR.tag.count)
        .map((t) => softTruncate(t, FIVERR.tag.max)),
      faqs: value.faqs.map((f) => ({
        question: softTruncate(f.question, FIVERR.faq.question.max),
        answer: softTruncate(f.answer, FIVERR.faq.answer.max),
      })),
      packages: value.packages?.map((p) => ({
        name: softTruncate(p.name, FIVERR.package.name.max),
        description: softTruncate(p.description, FIVERR.package.description.max),
      })),
      requirements: value.requirements?.map((r) =>
        softTruncate(r, FIVERR.requirement.item.max),
      ),
    }),
  }
}

// ---------- Tests ----------

describe("runWithFiverrValidation", () => {
  it("passes on the first call when the LLM output is clean", async () => {
    const opts = makeOpts(baseValid)
    const { data, warnings, callsUsed } = await runWithFiverrValidation(opts)

    expect(callsUsed).toBe(1)
    expect(data.title).toBe(baseValid.title)
    expect(warnings).toEqual([])
  })

  it("retries when the first response breaches a hard cap, and accepts the retry", async () => {
    const bad: Shape = {
      ...baseValid,
      title: "x".repeat(FIVERR.title.max + 20),
    }
    const opts = makeOpts(bad, baseValid)

    const { warnings, callsUsed, data } = await runWithFiverrValidation(opts)

    expect(callsUsed).toBe(2)
    expect(data.title).toBe(baseValid.title)
    expect(warnings).toEqual([])

    const retryMsgs = seenMessages[1]
    const feedbackMsg = retryMsgs.find((m) => m.content.includes("title is"))
    expect(feedbackMsg).toBeTruthy()
    expect(feedbackMsg!.content).toContain("(max 80)")
  })

  it("falls back to truncation when the retry still has hard breaches", async () => {
    const bad: Shape = {
      ...baseValid,
      title:
        "I will build a custom cursor cursor cursor SaaS application this week with full authentication system and database integration",
    }
    const opts = makeOpts(bad, bad)

    const { data, warnings, callsUsed } = await runWithFiverrValidation(opts)

    expect(callsUsed).toBe(2)
    expect(data.title.length).toBeLessThanOrEqual(FIVERR.title.max)
    expect(warnings.some((w) => w.startsWith("Auto-trimmed:"))).toBe(true)
    expect(warnings.some((w) => w.includes("title"))).toBe(true)
  })

  it("retries when keyword density is below the description minimum and surfaces the soft warning if still under", async () => {
    const weak: Shape = {
      ...baseValid,
      // Zero mentions of "cursor" in the description — below descMin.
      description: "I will build your SaaS app using my full stack expertise.",
    }
    const opts = makeOpts(weak, weak)

    const { warnings, callsUsed } = await runWithFiverrValidation(opts)

    expect(callsUsed).toBe(2)
    expect(
      warnings.some(
        (w) =>
          w.includes("primary keyword") && w.includes("in the description"),
      ),
    ).toBe(true)
  })

  it("emits a warning when the description exceeds the keyword ceiling (over-density / spam risk)", async () => {
    const stuffed: Shape = {
      ...baseValid,
      // Many mentions of "cursor" — over the descMax of 4.
      description: `${"cursor ".repeat(12)}SaaS app build fast.`,
    }
    const opts = makeOpts(stuffed, stuffed)

    const { warnings } = await runWithFiverrValidation(opts)

    expect(
      warnings.some(
        (w) =>
          w.includes("primary keyword") &&
          w.includes("description") &&
          /MAX/i.test(w),
      ),
    ).toBe(true)
  })

  it("emits a warning when the title contains the keyword more than the ceiling", async () => {
    const stuffedTitle: Shape = {
      ...baseValid,
      // 7 mentions of "cursor" — over the titleMax of 5.
      title: "cursor cursor cursor cursor cursor cursor cursor app",
    }
    const opts = makeOpts(stuffedTitle, stuffedTitle)

    const { warnings } = await runWithFiverrValidation(opts)

    expect(
      warnings.some(
        (w) =>
          w.includes("primary keyword") &&
          w.includes("title") &&
          /MAX/i.test(w),
      ),
    ).toBe(true)
  })

  it("emits a warning when no tag anchors the primary keyword (below tagMin)", async () => {
    const weakTags: Shape = {
      ...baseValid,
      tags: ["nextjs saas", "ai app", "developer", "build", "fast"],
    }
    const opts = makeOpts(weakTags, weakTags)

    const { warnings } = await runWithFiverrValidation(opts)

    expect(
      warnings.some(
        (w) =>
          w.includes("tags contain the primary keyword") ||
          w.includes("contain the primary keyword"),
      ),
    ).toBe(true)
  })

  it("emits a warning when too many tags contain the keyword (above tagMax)", async () => {
    const stuffedTags: Shape = {
      ...baseValid,
      tags: [
        "cursor saas",
        "cursor mvp",
        "cursor dev",
        "cursor build",
        "cursor fast",
      ],
    }
    const opts = makeOpts(stuffedTags, stuffedTags)

    const { warnings } = await runWithFiverrValidation(opts)

    expect(
      warnings.some(
        (w) =>
          w.includes("tags") &&
          w.includes("primary keyword") &&
          /MAX/i.test(w),
      ),
    ).toBe(true)
  })

  it("survives a thrown retry by truncating the original response", async () => {
    const bad: Shape = {
      ...baseValid,
      title: "x".repeat(FIVERR.title.max + 5),
    }
    const opts = makeOpts(baseValid)
    // Drain the placeholder push that `makeOpts` added so the queue only
    // has the bad response.
    responseQueue.length = 0
    responseQueue.push({ content: asResponse(bad) })

    const { data, warnings } = await runWithFiverrValidation(opts)

    expect(data.title.length).toBeLessThanOrEqual(FIVERR.title.max)
    expect(warnings.some((w) => w.startsWith("Auto-trimmed:"))).toBe(true)
  })
})
