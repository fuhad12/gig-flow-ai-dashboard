import { describe, it, expect } from "vitest"

import { discoverKeywords } from "@/lib/keyword-discovery"
import type { NicheGig } from "@/lib/trends"

function gig(position: number, title: string): NicheGig {
  return {
    url: `https://www.fiverr.com/seller-${position}/gig-${position}`,
    title,
    price: 50,
    rating: 4.8,
    reviewCount: 100,
    sellerLevel: "Level 2",
    position,
  }
}

describe("discoverKeywords", () => {
  it("returns an empty result for an empty input", () => {
    const out = discoverKeywords("test", [])
    expect(out.candidates).toEqual([])
    expect(out.sampleSize).toBe(0)
    expect(out.topSize).toBe(0)
  })

  it("flags a phrase as a high opportunity when it is broadly used but not in the top", () => {
    const gigs: NicheGig[] = [
      // Top 10 — none mention "cursor".
      gig(1, "I will build a Next.js SaaS MVP fast"),
      gig(2, "I will develop your AI app with Supabase"),
      gig(3, "I will create a full stack web app"),
      gig(4, "I will build modern landing pages"),
      gig(5, "I will integrate OpenAI into your app"),
      gig(6, "I will fix bugs in your React project"),
      gig(7, "I will set up Stripe for your SaaS"),
      gig(8, "I will deploy your Next.js app to Vercel"),
      gig(9, "I will add auth to your existing app"),
      gig(10, "I will write tests for your React code"),
      // Tail — many mention "cursor".
      gig(11, "I will build your cursor ai app fast"),
      gig(12, "I will fix bugs in your cursor ai project"),
      gig(13, "I will set up cursor ai for your team"),
      gig(14, "I will integrate cursor ai with Supabase"),
      gig(15, "I will teach cursor ai best practices"),
      gig(16, "I will migrate from Copilot to cursor ai"),
      gig(17, "I will configure cursor ai rules and skills"),
    ]

    const out = discoverKeywords("AI Apps", gigs)
    expect(out.sampleSize).toBe(gigs.length)
    expect(out.topSize).toBe(10)

    // The 1-gram "cursor" wins the dedup over "cursor ai" because it has
    // the same opportunity score but is shorter (inserted first by the
    // n-gram loop).
    const cursor = out.candidates.find((c) => c.phrase === "cursor")
    expect(cursor).toBeTruthy()
    expect(cursor!.tier).toBe("high")
    expect(cursor!.topPct).toBe(0)
    expect(cursor!.fullPct).toBeGreaterThan(30)
    expect(cursor!.opportunity).toBeGreaterThan(0)
  })

  it("flags a phrase as saturated when most top gigs use it", () => {
    const gigs: NicheGig[] = []
    // 10 top gigs all mention "react native".
    for (let i = 1; i <= 10; i++) {
      gigs.push(gig(i, `I will build a react native expo app ${i}`))
    }
    // 5 tail gigs that don't.
    for (let i = 11; i <= 15; i++) {
      gigs.push(gig(i, `I will design a stunning mobile ui ${i}`))
    }

    const out = discoverKeywords("Mobile Apps", gigs)
    // 1-grams dominate dedup, so we look for any saturated phrase that
    // came from the "react native" cluster.
    const phrase = out.candidates.find(
      (c) =>
        c.tier === "saturated" &&
        (c.phrase === "react" || c.phrase === "native"),
    )
    expect(phrase).toBeTruthy()
    expect(phrase!.topPct).toBeGreaterThanOrEqual(60)
  })

  it("excludes 1-grams that are domain filler (e.g. 'website')", () => {
    const gigs: NicheGig[] = []
    for (let i = 1; i <= 15; i++) {
      gigs.push(gig(i, "I will build a beautiful website for you"))
    }
    const out = discoverKeywords("Web Design", gigs)
    expect(out.candidates.find((c) => c.phrase === "website")).toBeUndefined()
  })

  it("ranks candidates by tier with high opportunities first", () => {
    // Mix of a clear high-opportunity phrase + a saturated one.
    const gigs: NicheGig[] = []
    for (let i = 1; i <= 10; i++) {
      // Saturated at the top.
      gigs.push(gig(i, `I will build a react native app ${i}`))
    }
    for (let i = 11; i <= 20; i++) {
      // High opportunity in the tail (10/20 = 50%, top 0%).
      gigs.push(gig(i, `I will set up flutterflow no code app ${i}`))
    }
    const out = discoverKeywords("Mobile", gigs)
    expect(out.candidates.length).toBeGreaterThan(0)
    // First entry should be one of the "high" tier phrases.
    expect(out.candidates[0].tier).toBe("high")
  })

  it("respects the `max` option to cap result length", () => {
    const gigs: NicheGig[] = []
    for (let i = 1; i <= 20; i++) {
      gigs.push(
        gig(
          i,
          `I will build alpha beta gamma delta epsilon zeta eta theta iota ${i}`,
        ),
      )
    }
    const out = discoverKeywords("test", gigs, { max: 5 })
    expect(out.candidates.length).toBeLessThanOrEqual(5)
  })

  it("deduplicates n-grams that overlap with a same-tier candidate", () => {
    const gigs: NicheGig[] = []
    // The 1-gram "next" / "js" / "saas" / "mvp" will all be the SAME
    // high tier as the 2-gram "next js" and the 3-gram "next js saas",
    // because they share the exact same prevalence statistics. The
    // dedup must keep at most one phrase from each overlapping group.
    for (let i = 1; i <= 10; i++) {
      gigs.push(gig(i, `I will build a website for you ${i}`))
    }
    for (let i = 11; i <= 22; i++) {
      gigs.push(gig(i, `I will build a next js saas mvp ${i}`))
    }
    const out = discoverKeywords("dev", gigs)
    // No candidate should overlap with another kept candidate of the
    // same tier.
    for (let i = 0; i < out.candidates.length; i++) {
      for (let j = i + 1; j < out.candidates.length; j++) {
        const a = out.candidates[i]
        const b = out.candidates[j]
        if (a.tier !== b.tier) continue
        const overlaps =
          a.phrase.includes(b.phrase) || b.phrase.includes(a.phrase)
        expect(overlaps).toBe(false)
      }
    }
  })
})
