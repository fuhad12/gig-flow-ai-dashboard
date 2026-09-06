/**
 * Unit tests for the in-memory sliding-window rate limiter.
 *
 * The limiter is load-bearing — it sits in front of every billable
 * LLM/Firecrawl endpoint — so we cover the boundary cases that have
 * historically bitten similar implementations: the off-by-one at the
 * limit, hits aging out of the window correctly, the IP extractor
 * handling proxy chains, and bucket isolation per key.
 */

import { describe, it, expect, beforeEach } from "vitest"

import {
  __resetRateLimitForTests,
  checkRateLimit,
  ipFromRequest,
} from "@/lib/rate-limit"

beforeEach(() => {
  __resetRateLimitForTests()
})

describe("checkRateLimit", () => {
  it("allows hits up to the limit then blocks the (limit+1)-th", () => {
    const opts = { key: "ip-a:analyze", limit: 3, windowMs: 60_000 }
    expect(checkRateLimit(opts).allowed).toBe(true)
    expect(checkRateLimit(opts).allowed).toBe(true)
    const last = checkRateLimit(opts)
    expect(last.allowed).toBe(true)
    expect(last.remaining).toBe(0)
    const blocked = checkRateLimit(opts)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(0)
    expect(blocked.message).toMatch(/too many requests/i)
  })

  it("keeps buckets isolated per key", () => {
    const a = { key: "ip-a:analyze", limit: 1, windowMs: 60_000 }
    const b = { key: "ip-b:analyze", limit: 1, windowMs: 60_000 }
    expect(checkRateLimit(a).allowed).toBe(true)
    expect(checkRateLimit(b).allowed).toBe(true)
    expect(checkRateLimit(a).allowed).toBe(false)
    expect(checkRateLimit(b).allowed).toBe(false)
  })

  it("uses a sliding window — old hits age out", async () => {
    // Use a tiny window so the test runs in milliseconds.
    const opts = { key: "sliding:k", limit: 2, windowMs: 80 }
    expect(checkRateLimit(opts).allowed).toBe(true)
    expect(checkRateLimit(opts).allowed).toBe(true)
    expect(checkRateLimit(opts).allowed).toBe(false)
    await new Promise((r) => setTimeout(r, 110))
    expect(checkRateLimit(opts).allowed).toBe(true)
  })

  it("reports retryAfter in seconds when blocked", () => {
    const opts = { key: "retry:k", limit: 1, windowMs: 30_000 }
    checkRateLimit(opts)
    const blocked = checkRateLimit(opts)
    expect(blocked.allowed).toBe(false)
    // Should be roughly windowMs/1000 = 30, allowing some test-execution slack.
    expect(blocked.retryAfterSec).toBeGreaterThan(25)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(30)
  })
})

describe("ipFromRequest", () => {
  function makeReq(headers: Record<string, string>): Request {
    return new Request("https://example.test/", { headers })
  }

  it("prefers the leftmost entry of x-forwarded-for", () => {
    const req = makeReq({
      "x-forwarded-for": "203.0.113.1, 10.0.0.1, 10.0.0.2",
    })
    expect(ipFromRequest(req)).toBe("203.0.113.1")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = makeReq({ "x-real-ip": "198.51.100.7" })
    expect(ipFromRequest(req)).toBe("198.51.100.7")
  })

  it('returns "unknown" when no proxy headers are present', () => {
    const req = makeReq({})
    expect(ipFromRequest(req)).toBe("unknown")
  })

  it("trims whitespace from the extracted IP", () => {
    const req = makeReq({ "x-forwarded-for": "   192.0.2.5  , 10.0.0.1" })
    expect(ipFromRequest(req)).toBe("192.0.2.5")
  })
})
