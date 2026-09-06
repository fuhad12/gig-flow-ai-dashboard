import { describe, expect, it } from "vitest"

import {
  NICHE_SLUG_REGEX,
  getNiche,
  getNicheDisplayName,
  isCustomNiche,
  slugifyNiche,
} from "@/lib/niches"

// Sanity check that the curated catalog still loads. If this ever
// regresses the rest of the suite will too — keep it here as a
// canary so the failure points at the obvious place.
describe("predefined niche catalog", () => {
  it("includes the default seller verticals", () => {
    expect(getNiche("ai-apps")).toBeDefined()
    expect(getNiche("logo-design")).toBeDefined()
    expect(getNiche("voiceover")).toBeDefined()
  })

  it("returns undefined for slugs that aren't curated", () => {
    expect(getNiche("tarot-reading")).toBeUndefined()
    expect(getNiche("resume-writing")).toBeUndefined()
  })
})

describe("slugifyNiche", () => {
  it("lowercases, hyphenates, and trims user input", () => {
    expect(slugifyNiche("Tarot Reading")).toBe("tarot-reading")
    expect(slugifyNiche("  Resume Writing  ")).toBe("resume-writing")
    expect(slugifyNiche("UI/UX Design")).toBe("uiux-design")
  })

  it("collapses runs of whitespace and hyphens", () => {
    expect(slugifyNiche("pet   portraits")).toBe("pet-portraits")
    expect(slugifyNiche("pet--portraits")).toBe("pet-portraits")
    expect(slugifyNiche("  -  pet -- portraits -  ")).toBe("pet-portraits")
  })

  it("strips punctuation while preserving alphanumeric characters", () => {
    expect(slugifyNiche("Brand Identity (Logo + Style Guide)")).toBe(
      "brand-identity-logo-style-guide",
    )
    expect(slugifyNiche("C++ programming")).toBe("c-programming")
  })

  it("normalizes accents", () => {
    // "Café Décor" → "cafe-decor"
    expect(slugifyNiche("Café Décor")).toBe("cafe-decor")
  })

  it("returns an empty string for input that has no usable characters", () => {
    expect(slugifyNiche("")).toBe("")
    expect(slugifyNiche("   ")).toBe("")
    expect(slugifyNiche("---")).toBe("")
    expect(slugifyNiche("!@#$%^&*()")).toBe("")
  })

  it("caps the slug length at 40 characters", () => {
    const longInput = "a".repeat(100)
    const slug = slugifyNiche(longInput)
    expect(slug.length).toBeLessThanOrEqual(40)
  })

  it("never leaves a trailing hyphen after capping", () => {
    // 40 chars of "ab" then truncated should not end with a stray "-"
    const slug = slugifyNiche("ab ".repeat(30))
    expect(slug.endsWith("-")).toBe(false)
    expect(slug.startsWith("-")).toBe(false)
  })
})

describe("NICHE_SLUG_REGEX", () => {
  it("accepts every slug in the predefined catalog", () => {
    const catalogSlugs = [
      "ai-apps",
      "web-development",
      "logo-design",
      "ui-ux",
      "voiceover",
      "social-media",
      "virtual-assistant",
    ]
    for (const slug of catalogSlugs) {
      expect(NICHE_SLUG_REGEX.test(slug)).toBe(true)
    }
  })

  it("accepts well-formed custom slugs", () => {
    expect(NICHE_SLUG_REGEX.test("tarot-reading")).toBe(true)
    expect(NICHE_SLUG_REGEX.test("resume-writing")).toBe(true)
    expect(NICHE_SLUG_REGEX.test("pet-portraits")).toBe(true)
    expect(NICHE_SLUG_REGEX.test("c4")).toBe(true)
  })

  it("rejects slugs with leading or trailing hyphens", () => {
    expect(NICHE_SLUG_REGEX.test("-tarot")).toBe(false)
    expect(NICHE_SLUG_REGEX.test("tarot-")).toBe(false)
    expect(NICHE_SLUG_REGEX.test("-tarot-")).toBe(false)
  })

  it("rejects slugs with consecutive hyphens", () => {
    expect(NICHE_SLUG_REGEX.test("tarot--reading")).toBe(false)
  })

  it("rejects slugs with uppercase or punctuation", () => {
    expect(NICHE_SLUG_REGEX.test("Tarot")).toBe(false)
    expect(NICHE_SLUG_REGEX.test("tarot reading")).toBe(false)
    expect(NICHE_SLUG_REGEX.test("tarot/reading")).toBe(false)
  })

  it("rejects too-short or too-long slugs", () => {
    expect(NICHE_SLUG_REGEX.test("a")).toBe(false)
    expect(NICHE_SLUG_REGEX.test("a".repeat(41))).toBe(false)
  })
})

describe("getNicheDisplayName", () => {
  it("returns the catalog name for predefined slugs", () => {
    expect(getNicheDisplayName("ai-apps")).toBe("AI Apps")
    expect(getNicheDisplayName("logo-design")).toBe("Logo Design")
    expect(getNicheDisplayName("voiceover")).toBe("Voiceover")
  })

  it("title-cases custom slugs as a fallback", () => {
    expect(getNicheDisplayName("tarot-reading")).toBe("Tarot Reading")
    expect(getNicheDisplayName("pet-portraits")).toBe("Pet Portraits")
    expect(getNicheDisplayName("resume-writing")).toBe("Resume Writing")
  })

  it("handles single-word custom slugs", () => {
    expect(getNicheDisplayName("astrology")).toBe("Astrology")
  })
})

describe("isCustomNiche", () => {
  it("is false for predefined slugs", () => {
    expect(isCustomNiche("ai-apps")).toBe(false)
    expect(isCustomNiche("logo-design")).toBe(false)
  })

  it("is true for slugs not in the catalog", () => {
    expect(isCustomNiche("tarot-reading")).toBe(true)
    expect(isCustomNiche("pet-portraits")).toBe(true)
  })
})

// Integration: the contract the API relies on. Anything that slugifies
// cleanly should also pass the regex; the two helpers must agree.
describe("slugifyNiche → NICHE_SLUG_REGEX contract", () => {
  const samples = [
    "Tarot Reading",
    "Resume Writing",
    "Pet Portraits",
    "Astrology",
    "Wedding Planning",
    "Brand Identity",
    "C++ Programming",
    "Café Décor",
  ]
  for (const sample of samples) {
    it(`slugifyNiche(${JSON.stringify(sample)}) passes NICHE_SLUG_REGEX`, () => {
      const slug = slugifyNiche(sample)
      expect(slug.length).toBeGreaterThanOrEqual(2)
      expect(NICHE_SLUG_REGEX.test(slug)).toBe(true)
    })
  }
})
