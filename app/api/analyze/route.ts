import { NextResponse } from "next/server"
import { z } from "zod"

import { scrapeFiverrGig } from "@/lib/scraper"
import { getCachedAnalysis, normalizeUrl, storeAnalysis } from "@/lib/cache"
import { createSupabaseServer } from "@/lib/supabase/server"
import {
  chargeCredit,
  getQuotaStatus,
  releaseReservation,
  reserveCreditSlot,
  updateReservation,
} from "@/lib/quota"
import { analyzeGigWithLLM } from "@/lib/llm/analyze-gig"
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit"
import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"

// IP-based rate limit. Per-user monthly quota already blocks abuse from
// one account; this catches the multi-account abuse pattern (one IP
// signing up 50 throwaway accounts to burn through Firecrawl + LLM
// budget). Override via env vars when tuning.
const ANALYZE_RATE_LIMIT = parseInt(
  process.env.ANALYZE_RATE_LIMIT_PER_HOUR ?? "10",
  10,
)
const ANALYZE_RATE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export const runtime = "nodejs"
export const maxDuration = 90

// ---------- Request validation ----------

const RequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "url is required")
    .url("url must be a valid URL"),
  refresh: z.boolean().optional().default(false),
})

// ---------- Route handler ----------

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    )
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { url, refresh } = parsed.data

  // 1. IP-based throttle (defense in depth on top of per-user quota).
  const ip = ipFromRequest(req)
  const rl = checkRateLimit({
    key: `${ip}:analyze`,
    limit: ANALYZE_RATE_LIMIT,
    windowMs: ANALYZE_RATE_WINDOW_MS,
  })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: rl.message, retryAfterSec: rl.retryAfterSec },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    )
  }

  // 2. Require an authenticated user.
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured on the server" },
      { status: 500 },
    )
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in to analyze a gig" },
      { status: 401 },
    )
  }

  // 3. Enforce per-user monthly quota.
  const quota = await getQuotaStatus(user.id)
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: `Monthly AI credit limit reached (${quota.used}/${quota.limit}). Upgrade for more credits.`,
        quota,
      },
      { status: 402 },
    )
  }

  // 4. Cache hit short-circuit (still counts toward the user's quota because
  //    we always insert a row below).
  if (!refresh) {
    const cached = await getCachedAnalysis(url)
    if (cached) {
      const id = await storeAnalysis(
        url,
        user.id,
        cached.scraped,
        cached.analysis,
      )
      // Bill the credit — if the user has now exceeded their monthly cap,
      // chargeCredit() atomically decrements the oldest topup. The pre-gate
      // already confirmed `quota.allowed`, so this can only land on
      // monthly or topup, never "overage" in the happy path.
      await chargeCredit(user.id)
      return NextResponse.json(
        {
          id,
          url,
          scraped: cached.scraped,
          analysis: cached.analysis,
          cached: true,
          cachedAt: cached.cachedAt,
        },
        { status: 200 },
      )
    }
  }

  // 5. Scrape (no credit consumed yet — Firecrawl is the cheap part).
  let scraped: ScrapedGig
  try {
    scraped = await scrapeFiverrGig(url)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to scrape the gig page"
    return NextResponse.json(
      { error: message, stage: "scrape" },
      { status: 502 },
    )
  }

  // 6. Reserve a credit slot ATOMICALLY before the expensive LLM call.
  // The RPC takes an advisory lock per-user so two concurrent analyzes
  // can't both pass the gate. We insert the scraped data immediately so
  // the row that lands in history is already authoritative even if the
  // LLM step fails partway.
  let reservationId: string | null
  try {
    reservationId = await reserveCreditSlot({
      userId: user.id,
      kind: "analysis",
      payload: {
        url: normalizeUrl(url),
        scraped,
        // analysis stays as `{}` placeholder until the LLM returns.
      },
    })
  } catch (err) {
    console.error("[analyze] reservation failed:", err)
    return NextResponse.json(
      {
        error:
          "Couldn't reserve a credit slot. Please try again — if this keeps happening contact support.",
      },
      { status: 500 },
    )
  }
  if (!reservationId) {
    return NextResponse.json(
      {
        error: `Monthly AI credit limit reached (${quota.used}/${quota.limit}). Upgrade for more credits.`,
        quota,
      },
      { status: 402 },
    )
  }

  // 7. Analyze.
  let analysis: GigAnalysis
  try {
    analysis = await analyzeGigWithLLM(scraped)
  } catch (err) {
    // Roll back the reservation so the user isn't billed for compute we
    // never delivered.
    await releaseReservation("gig_analyses", reservationId)
    const message =
      err instanceof Error ? err.message : "Failed to analyze the gig"
    const isConfigError =
      message.includes("OPENAI_API_KEY") || message.includes("GEMINI_API_KEY")
    const isCapacity =
      /\b503\b/.test(message) ||
      /high demand/i.test(message) ||
      /temporarily overloaded/i.test(message) ||
      /try again later/i.test(message)
    return NextResponse.json(
      { error: message, stage: "analyze" },
      // 503 tells the UI "retry soon"; 500 is config; everything else is
      // an upstream failure we surface as 502.
      { status: isConfigError ? 500 : isCapacity ? 503 : 502 },
    )
  }

  // 8. Fill in the real analysis on the reserved row.
  await updateReservation("gig_analyses", reservationId, { analysis })

  // 9. Bill the credit (monthly first, topup overflow second).
  await chargeCredit(user.id)

  return NextResponse.json(
    {
      id: reservationId,
      url,
      scraped,
      analysis,
      cached: false,
    },
    { status: 200 },
  )
}
