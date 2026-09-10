import { describe, it, expect } from "vitest"

import {
  FIVERR,
  checkDescription,
  checkFaq,
  checkPackages,
  checkRequirements,
  checkTags,
  checkTitle,
  classifyLength,
  countKeywordOccurrences,
  endsWithOrphanHeading,
  finalizeGigDescription,
  formatViolationsForRetry,
  keywordCorpus,
  softTruncate,
  type Violation,
} from "@/lib/fiverr-limits"

describe("classifyLength", () => {
  it("returns 'empty' for an empty value", () => {
    expect(
      classifyLength({ length: 0, max: 80, optimalMin: 50, optimalMax: 59 }),
    ).toBe("empty")
  })

  it("returns 'over-max' when length exceeds max", () => {
    expect(classifyLength({ length: 81, max: 80 })).toBe("over-max")
  })

  it("returns 'over-optimal' when length is above optimalMax but at/under max", () => {
    expect(
      classifyLength({ length: 60, max: 80, optimalMin: 50, optimalMax: 59 }),
    ).toBe("over-optimal")
  })

  it("returns 'under' when length is below optimalMin", () => {
    expect(
      classifyLength({ length: 40, max: 80, optimalMin: 50, optimalMax: 59 }),
    ).toBe("under")
  })

  it("returns 'optimal' when inside the optimal range", () => {
    expect(
      classifyLength({ length: 55, max: 80, optimalMin: 50, optimalMax: 59 }),
    ).toBe("optimal")
  })

  it("treats fields without optimal bounds as 'optimal' when non-empty", () => {
    expect(classifyLength({ length: 10, max: 20 })).toBe("optimal")
  })
})

describe("softTruncate", () => {
  it("returns the input unchanged when shorter than max", () => {
    expect(softTruncate("hello world", 80)).toBe("hello world")
  })

  it("returns the input unchanged when exactly at max", () => {
    expect(softTruncate("a".repeat(80), 80)).toBe("a".repeat(80))
  })

  it("cuts at the last full sentence within the slice", () => {
    const input =
      "First sentence here. Second sentence is also done. Third sentence trails off and goes beyond"
    // 60-char window should keep "First sentence here. Second sentence is also done."
    const out = softTruncate(input, 60)
    expect(out.endsWith(".")).toBe(true)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out).toBe("First sentence here. Second sentence is also done.")
  })

  it("falls back to last word boundary when no sentence cut is found", () => {
    const input = "alpha beta gamma delta epsilon zeta eta theta iota"
    const out = softTruncate(input, 25)
    expect(out.length).toBeLessThanOrEqual(25)
    // Must end with an ellipsis OR a non-space character.
    expect(out.endsWith(" ")).toBe(false)
    // Should not have chopped a word in half.
    expect(out).toMatch(/[a-z](…)?$/)
  })

  it("hard slices as a last resort when there are no spaces", () => {
    const out = softTruncate("a".repeat(120), 50)
    expect(out.length).toBeLessThanOrEqual(50)
    expect(out).toBe("a".repeat(50))
  })

  it("does not consider sentence/word cuts found in the first half of the slice", () => {
    // The only "." is super early — soft logic should ignore it.
    const input = "a. " + "b".repeat(200)
    const out = softTruncate(input, 50)
    expect(out.length).toBeLessThanOrEqual(50)
    // Sentence cut would have produced just "a." which is < max*0.5,
    // so we fall through to the hard slice path (no spaces beyond index 1).
    expect(out.startsWith("a. ")).toBe(true)
  })

  it("avoids cutting right after a bare section heading", () => {
    const body =
      "Hook line with a buyer outcome. Credibility next. Deliverables listed carefully here. "
    const heading = "WHAT I NEED FROM YOU:\n"
    const rest = "x".repeat(200)
    const input = body + heading + rest
    // Window that includes the heading newline but not enough for body.
    const max = body.length + heading.length + 5
    const out = softTruncate(input, max)
    expect(out.length).toBeLessThanOrEqual(max)
    expect(endsWithOrphanHeading(out)).toBe(false)
  })
})

describe("finalizeGigDescription", () => {
  it("strips orphan headings and appends a CTA", () => {
    const input =
      "I will fix your Base44 bugs fast.\n\nWHAT I NEED FROM YOU:"
    const out = finalizeGigDescription(input, 1200)
    expect(endsWithOrphanHeading(out)).toBe(false)
    expect(out.toLowerCase()).not.toMatch(/what i need from you:\s*$/i)
    expect(out.length).toBeGreaterThan(40)
    expect(out.length).toBeLessThanOrEqual(1200)
  })

  it("keeps a complete description under the cap", () => {
    const input =
      "I will debug your Base44 app.\n\nYou get a clear fix plan.\n\nOrder now to start."
    expect(finalizeGigDescription(input, 1200)).toBe(input)
  })
})

describe("countKeywordOccurrences", () => {
  it("returns 0 for an empty keyword", () => {
    expect(countKeywordOccurrences("anything goes here", "")).toBe(0)
    expect(countKeywordOccurrences("anything goes here", "   ")).toBe(0)
  })

  it("is case-insensitive", () => {
    expect(countKeywordOccurrences("Cursor cursor CURSOR", "cursor")).toBe(3)
    expect(countKeywordOccurrences("AI AI ai", "ai")).toBe(3)
  })

  it("matches whole words, not substrings", () => {
    // "ai" should NOT match inside "train" or "again".
    expect(countKeywordOccurrences("train airplane again", "ai")).toBe(0)
  })

  it("matches multi-word phrases as a single hit per occurrence", () => {
    const text =
      "I will build a Next.js SaaS MVP. My Next.js SaaS work is fast. Next.js SaaS demo."
    expect(countKeywordOccurrences(text, "next.js saas")).toBe(3)
  })

  it("handles keywords with special regex characters safely", () => {
    expect(countKeywordOccurrences("React + Next.js + Tailwind", "next.js")).toBe(1)
    // The "." in the keyword must not act as a wildcard.
    expect(countKeywordOccurrences("nextXjs is fine", "next.js")).toBe(0)
  })

  it("counts whole-token matches only (word-boundary aware)", () => {
    // 'aaaa' is a single token — \baa\b should NOT match inside it.
    expect(countKeywordOccurrences("aaaa", "aa")).toBe(0)
    // But "aa aa" gives two standalone tokens — both match.
    expect(countKeywordOccurrences("aa aa", "aa")).toBe(2)
  })

  it("works for keyword with leading non-word char (no leading boundary)", () => {
    expect(countKeywordOccurrences("price is $20 and $20 again", "$20")).toBe(2)
  })
})

describe("keywordCorpus", () => {
  it("returns ONLY the description", () => {
    expect(keywordCorpus({ description: "hello world" })).toBe("hello world")
  })
})

describe("checkTitle", () => {
  it("flags titles longer than the hard max", () => {
    const long = "a".repeat(FIVERR.title.max + 5)
    const v = checkTitle(long)
    expect(v).toHaveLength(1)
    expect(v[0].severity).toBe("hard")
    expect(v[0].field).toBe("title")
    expect(v[0].message).toContain(String(FIVERR.title.max + 5))
  })

  it("flags banned characters", () => {
    const v = checkTitle("I will build amazing & fast website")
    expect(v.some((x) => x.message.includes("banned characters"))).toBe(true)
  })

  it("returns empty for a clean title under the cap", () => {
    expect(checkTitle("I will build a Next.js SaaS in 5 days")).toEqual([])
  })

  it("flags both length AND banned chars simultaneously", () => {
    const v = checkTitle("a".repeat(FIVERR.title.max + 1) + "&")
    expect(v.length).toBeGreaterThanOrEqual(2)
  })
})

describe("checkDescription", () => {
  it("flags overlong descriptions", () => {
    const v = checkDescription("x".repeat(FIVERR.description.max + 1))
    expect(v).toHaveLength(1)
    expect(v[0].severity).toBe("hard")
  })

  it("accepts descriptions at the cap", () => {
    expect(checkDescription("y".repeat(FIVERR.description.max))).toEqual([])
  })
})

describe("checkTags", () => {
  it("flags wrong tag count", () => {
    const v = checkTags(["a", "b"])
    expect(v.some((x) => x.message.includes("entries"))).toBe(true)
  })

  it("flags individual oversized tags", () => {
    const tags = ["ok", "ok", "ok", "ok", "x".repeat(FIVERR.tag.max + 1)]
    const v = checkTags(tags)
    // 1 violation for the long tag; count is correct so no count violation.
    expect(v).toHaveLength(1)
    expect(v[0].field).toBe("tags[4]")
  })

  it("returns empty when count + each tag are valid", () => {
    expect(checkTags(["a", "b", "c", "d", "e"])).toEqual([])
  })
})

describe("checkFaq", () => {
  it("flags oversized questions and answers separately", () => {
    const faqs = [
      {
        question: "x".repeat(FIVERR.faq.question.max + 1),
        answer: "y".repeat(FIVERR.faq.answer.max + 1),
      },
    ]
    const v = checkFaq(faqs)
    expect(v).toHaveLength(2)
    expect(v[0].field).toBe("faqs[0].question")
    expect(v[1].field).toBe("faqs[0].answer")
  })
})

describe("checkPackages", () => {
  it("flags oversized name and description", () => {
    const pkgs = [
      {
        name: "n".repeat(FIVERR.package.name.max + 1),
        description: "d".repeat(FIVERR.package.description.max + 1),
      },
    ]
    const v = checkPackages(pkgs)
    expect(v).toHaveLength(2)
  })
})

describe("checkRequirements", () => {
  it("flags oversized items", () => {
    const items = [
      "ok",
      "z".repeat(FIVERR.requirement.item.max + 1),
    ]
    const v = checkRequirements(items)
    expect(v).toHaveLength(1)
    expect(v[0].field).toBe("requirements[1]")
  })
})

describe("formatViolationsForRetry", () => {
  it("returns an empty string when no violations", () => {
    expect(formatViolationsForRetry([])).toBe("")
  })

  it("formats violations as a bullet list with a lead line", () => {
    const vs: Violation[] = [
      { field: "title", message: "title too long", severity: "hard" },
      { field: "tags", message: "wrong tag count", severity: "hard" },
    ]
    const out = formatViolationsForRetry(vs)
    expect(out).toContain("Your previous response violated")
    expect(out).toContain("- title too long")
    expect(out).toContain("- wrong tag count")
  })
})
