import { describe, expect, it } from "vitest"

import { inferAccountStage } from "@/lib/llm/optimize-profile"
import { detectRateFamily, rateBandForNicheStage } from "@/lib/niche-rates"
import { rateBandForStage } from "@/lib/profile-optimizer-types"

describe("inferAccountStage", () => {
  it("treats thin profiles as getting_started", () => {
    expect(
      inferAccountStage({
        namedClients: 0,
        portfolioTitles: 0,
        workHistory: 0,
        overviewLength: 200,
        score: 40,
      }),
    ).toBe("getting_started")
  })

  it("moves to building_proof with some evidence", () => {
    expect(
      inferAccountStage({
        namedClients: 1,
        portfolioTitles: 2,
        workHistory: 0,
        overviewLength: 900,
        score: 65,
      }),
    ).toBe("building_proof")
  })

  it("allows established only with strong proof", () => {
    expect(
      inferAccountStage({
        namedClients: 2,
        portfolioTitles: 3,
        workHistory: 2,
        overviewLength: 1200,
        score: 82,
      }),
    ).toBe("established")
  })
})

describe("niche rate bands", () => {
  it("detects families from niches and text", () => {
    expect(detectRateFamily({ nicheSlugs: ["web-development"] })).toBe(
      "web_dev",
    )
    expect(detectRateFamily({ nicheSlugs: ["copywriting"] })).toBe("writing")
    expect(
      detectRateFamily({
        profileText: "Klaviyo email marketing sequences and SEO landing pages",
      }),
    ).toBe("marketing")
  })

  it("gives writers a lower entry band than web developers", () => {
    const writing = rateBandForNicheStage(
      "upwork",
      "getting_started",
      "writing",
    )
    const web = rateBandForNicheStage("upwork", "getting_started", "web_dev")
    expect(writing.target).toBeLessThan(web.target)
    expect(writing.max).toBeLessThanOrEqual(web.max)
  })

  it("caps getting_started web rates well below premium", () => {
    const band = rateBandForStage("upwork", "getting_started", "web_dev")
    expect(band.max).toBeLessThan(40)
  })
})
