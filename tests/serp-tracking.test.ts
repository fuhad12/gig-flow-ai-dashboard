import { describe, it, expect } from "vitest"

import { buildSearchUrl, gigPathKey } from "@/lib/serp-tracking"

describe("gigPathKey", () => {
  it("reduces a clean Fiverr URL to <seller>/<slug>", () => {
    expect(
      gigPathKey(
        "https://www.fiverr.com/janesmith/i-will-build-a-nextjs-saas-mvp",
      ),
    ).toBe("janesmith/i-will-build-a-nextjs-saas-mvp")
  })

  it("strips tracking params", () => {
    expect(
      gigPathKey(
        "https://www.fiverr.com/janesmith/i-will-build-a-nextjs-saas-mvp?source=search&ref=foo",
      ),
    ).toBe("janesmith/i-will-build-a-nextjs-saas-mvp")
  })

  it("strips locale prefixes", () => {
    expect(
      gigPathKey(
        "https://www.fiverr.com/en/janesmith/i-will-build-a-nextjs-saas-mvp",
      ),
    ).toBe("janesmith/i-will-build-a-nextjs-saas-mvp")
    expect(
      gigPathKey(
        "https://www.fiverr.com/es/janesmith/i-will-build-a-nextjs-saas-mvp",
      ),
    ).toBe("janesmith/i-will-build-a-nextjs-saas-mvp")
  })

  it("lowercases the result", () => {
    expect(
      gigPathKey("https://www.fiverr.com/JaneSmith/I-Will-Build-MVP"),
    ).toBe("janesmith/i-will-build-mvp")
  })

  it("returns the last two segments when extra path nesting is present", () => {
    expect(
      gigPathKey("https://www.fiverr.com/share/123/janesmith/my-gig"),
    ).toBe("janesmith/my-gig")
  })

  it("falls back to a path-only key when the URL has < 2 path segments", () => {
    expect(gigPathKey("https://www.fiverr.com/janesmith")).toBe("/janesmith")
  })

  it("falls back to the lowercased URL when input is not a valid URL", () => {
    expect(gigPathKey("not a url")).toBe("not a url")
    expect(gigPathKey("seller/slug?utm=ok")).toBe("seller/slug")
  })

  it("treats http and https hosts identically", () => {
    expect(
      gigPathKey("http://www.fiverr.com/seller/my-gig"),
    ).toBe(gigPathKey("https://www.fiverr.com/seller/my-gig"))
  })
})

describe("buildSearchUrl", () => {
  it("URL-encodes the query and replaces spaces with +", () => {
    expect(buildSearchUrl("nextjs saas mvp")).toBe(
      "https://www.fiverr.com/search/gigs?query=nextjs%2Bsaas%2Bmvp",
    )
  })

  it("trims whitespace", () => {
    expect(buildSearchUrl("  cursor ai   ")).toBe(
      "https://www.fiverr.com/search/gigs?query=cursor%2Bai",
    )
  })

  it("encodes special chars", () => {
    const out = buildSearchUrl("c# developer")
    expect(out).toContain("c%23")
  })
})
