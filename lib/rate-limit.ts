/**
 * In-memory sliding-window rate limiter.
 *
 * Purpose
 * -------
 * `/api/analyze`, `/api/generate`, and `/api/predict` already require auth
 * and enforce per-user monthly quotas, but those defenses don't stop
 * burst abuse — e.g. one person spinning up 50 disposable accounts to
 * burn through Firecrawl + LLM budget. An IP-based limiter is the
 * defense-in-depth layer that catches that pattern.
 *
 * Scope
 * -----
 * This is an intentionally simple per-process limiter using a Map.
 * Vercel runs API routes on serverless instances that are per-region
 * and short-lived, so the limit is enforced per-instance — a determined
 * attacker hitting multiple instances could get N × limit. That's still
 * orders of magnitude better than unlimited. For stricter enforcement
 * later, swap the `bucketStore` implementation for `@upstash/ratelimit`
 * (Redis-backed sliding window). Same `checkRateLimit()` signature, no
 * route changes needed.
 *
 * Usage
 * -----
 *   const limit = checkRateLimit({
 *     key: ipFromRequest(req) + ":analyze",
 *     limit: 5,
 *     windowMs: 60 * 60 * 1000, // 1 hour
 *   })
 *   if (!limit.allowed) {
 *     return NextResponse.json(
 *       { error: limit.message, retryAfterSec: limit.retryAfterSec },
 *       { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
 *     )
 *   }
 */

interface BucketEntry {
  /** Monotonic timestamps (ms) of each hit inside the current window. */
  hits: number[]
}

// Map<bucketKey, BucketEntry>. We cap the map at ~10k entries via a
// best-effort eviction below; that's enough for "abuse mitigation"
// without growing unbounded.
const bucketStore = new Map<string, BucketEntry>()
const MAX_TRACKED_KEYS = 10_000

function evictIfFull(): void {
  if (bucketStore.size <= MAX_TRACKED_KEYS) return
  // Oldest-first eviction. Maps preserve insertion order, so we drop
  // the head until we're back under the cap. Cheap and good enough.
  const overflow = bucketStore.size - MAX_TRACKED_KEYS
  let dropped = 0
  for (const key of bucketStore.keys()) {
    bucketStore.delete(key)
    dropped += 1
    if (dropped >= overflow) break
  }
}

export interface RateLimitOptions {
  /** Composite cache key, e.g. `${ip}:analyze`. */
  key: string
  /** Max hits permitted per window. */
  limit: number
  /** Window size in milliseconds. */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Hits used so far in the current window. */
  used: number
  /** Total budget for the window. */
  limit: number
  /** Hits remaining; 0 once `allowed === false`. */
  remaining: number
  /** Seconds until the OLDEST hit falls out of the window. */
  retryAfterSec: number
  /** Friendly user-facing message; empty when allowed. */
  message: string
}

/**
 * Atomically record a hit and decide whether the caller is over budget.
 *
 * Implementation: sliding-window log. We keep timestamps of each hit
 * and discard ones older than `windowMs` on every call. O(n) per call
 * in the worst case where n = limit; for our small limits (5-20) this
 * is negligible compared to the work the route does.
 */
export function checkRateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const cutoff = now - opts.windowMs

  let bucket = bucketStore.get(opts.key)
  if (!bucket) {
    bucket = { hits: [] }
    bucketStore.set(opts.key, bucket)
    evictIfFull()
  }
  // Drop hits outside the window.
  bucket.hits = bucket.hits.filter((t) => t > cutoff)

  if (bucket.hits.length >= opts.limit) {
    const oldest = bucket.hits[0] ?? now
    const retryAfterMs = Math.max(0, opts.windowMs - (now - oldest))
    return {
      allowed: false,
      used: bucket.hits.length,
      limit: opts.limit,
      remaining: 0,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
      message: `Too many requests. Try again in ${Math.ceil(retryAfterMs / 60_000)} minute(s).`,
    }
  }

  bucket.hits.push(now)
  return {
    allowed: true,
    used: bucket.hits.length,
    limit: opts.limit,
    remaining: opts.limit - bucket.hits.length,
    retryAfterSec: 0,
    message: "",
  }
}

/**
 * Extract the caller's IP from request headers in priority order:
 *   1. `x-forwarded-for` (set by Vercel + most reverse proxies)
 *   2. `x-real-ip`
 *   3. fallback "unknown"
 *
 * `x-forwarded-for` can be a comma-separated chain — the LEFTMOST entry
 * is the original client; the others are intermediate proxies. We take
 * the leftmost and trim it.
 */
export function ipFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = req.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  return "unknown"
}

/** Test-only: clear all buckets so unit tests don't bleed into each other. */
export function __resetRateLimitForTests(): void {
  bucketStore.clear()
}
