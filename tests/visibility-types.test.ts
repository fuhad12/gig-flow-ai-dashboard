import { describe, expect, it } from "vitest"

import {
  cleanChecklist,
  cleanProofQuotes,
  cleanQaPairs,
  DEFAULT_GIG_CHECKLIST,
  normalizeLayer,
} from "@/lib/visibility-types"

describe("visibility-types helpers", () => {
  it("normalizes layers and falls back to seo", () => {
    expect(normalizeLayer("GEO")).toBe("geo")
    expect(normalizeLayer("weird")).toBe("seo")
  })

  it("cleans QA pairs and drops junk", () => {
    const out = cleanQaPairs(
      [
        { question: "Do you include source files?", answer: "Yes — AI + EPS on delivery." },
        { question: "Hi", answer: "Nope" },
        { question: 1, answer: "bad" },
      ],
      5,
    )
    expect(out).toHaveLength(1)
    expect(out[0].question).toContain("source files")
  })

  it("pads checklist with defaults", () => {
    const out = cleanChecklist(
      [{ id: "x", layer: "aeo", title: "Write FAQs", detail: "Add three buyer objection FAQs to the gig." }],
      DEFAULT_GIG_CHECKLIST,
      4,
      7,
    )
    expect(out.length).toBeGreaterThanOrEqual(4)
    expect(out[0].layer).toBe("aeo")
  })

  it("filters proof quotes by length", () => {
    expect(
      cleanProofQuotes(["too short", "Shipped 12 Stripe Connect payout flows for SaaS teams."], 3),
    ).toEqual(["Shipped 12 Stripe Connect payout flows for SaaS teams."])
  })
})
