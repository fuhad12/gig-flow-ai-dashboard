import { describe, expect, it } from "vitest"

import { isFiverrGigDetailUrl } from "@/lib/scraper"

describe("isFiverrGigDetailUrl", () => {
  it("accepts seller/gig paths", () => {
    expect(
      isFiverrGigDetailUrl(
        "https://www.fiverr.com/jane_doe/i-will-design-a-logo",
      ),
    ).toBe(true)
  })

  it("rejects short share links and homepage", () => {
    expect(isFiverrGigDetailUrl("https://www.fiverr.com/s/EmO3kP8")).toBe(
      false,
    )
    expect(isFiverrGigDetailUrl("https://www.fiverr.com/")).toBe(false)
    expect(isFiverrGigDetailUrl("https://www.fiverr.com/categories/graphics")).toBe(
      false,
    )
  })
})
