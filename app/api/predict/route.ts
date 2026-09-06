import { NextResponse } from "next/server"
import { z } from "zod"

import { scrapeFiverrGig } from "@/lib/scraper"
import { getCachedAnalysis, normalizeUrl } from "@/lib/cache"
import { createSupabaseServer } from "@/lib/supabase/server"
import {
  chargeCredit,
  getQuotaStatus,
  releaseReservation,
  reserveCreditSlot,
  updateReservation,
} from "@/lib/quota"
import { analyzeGigWithLLM } from "@/lib/llm/analyze-gig"
import { predictConversionWithLLM } from "@/lib/llm/predict-conversion"
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit"
import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"
import type { ConversionPrediction } from "@/lib/prediction-types"

export const runtime = "nodejs"
export const maxDuration = 90

// IP-based throttle. Mirrors /api/analyze and /api/generate so the same
// abuse vector (mass account signups burning Firecrawl + LLM credits) is
// blocked on every billable endpoint.
const PREDICT_RATE_LIMIT = parseInt(
  process.env.PREDICT_RATE_LIMIT_PER_HOUR ?? "10",
  10,
)
const PREDICT_RATE_WINDOW_MS = 60 * 60 * 1000

const RequestSchema = z.object({
  url: z.string().trim().min(1, "url is required").url("url must be a valid URL"),
  refresh: z.boolean().optional().default(false),
})

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

  // 1. IP rate limit (defense in depth on top of per-user quota).
  const ip = ipFromRequest(req)
  const rl = checkRateLimit({
    key: `${ip}:predict`,
    limit: PREDICT_RATE_LIMIT,
    windowMs: PREDICT_RATE_WINDOW_MS,
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

  // 2. Auth.
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
      { error: "You must be signed in to run a prediction" },
      { status: 401 },
    )
  }

  // 3. Quota check.
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

  // 4. Get scrape + analysis (cache-first, fresh on miss/refresh).
  let scraped: ScrapedGig
  let analysis: GigAnalysis
  let analysisCached = false

  const cached = refresh ? null : await getCachedAnalysis(url)
  if (cached) {
    scraped = cached.scraped
    analysis = cached.analysis
    analysisCached = true
  } else {
    try {
      scraped = await scrapeFiverrGig(url)
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "Failed to scrape the gig page",
          stage: "scrape",
        },
        { status: 502 },
      )
    }
    // Reserve the credit slot ATOMICALLY before running the LLM. Same
    // rationale as /api/generate and /api/analyze: closes the TOCTOU
    // race and makes metering failures impossible to silently miss.
    let reservationId: string | null
    try {
      reservationId = await reserveCreditSlot({
        userId: user.id,
        kind: "analysis",
        payload: {
          url: normalizeUrl(url),
          scraped,
        },
      })
    } catch (err) {
      console.error("[predict] reservation failed:", err)
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
    try {
      analysis = await analyzeGigWithLLM(scraped)
    } catch (err) {
      // LLM failed — release the reserved slot so the user keeps their credit.
      await releaseReservation("gig_analyses", reservationId)
      const message = err instanceof Error ? err.message : "Failed to analyze the gig"
      return NextResponse.json(
        { error: message, stage: "analyze" },
        { status: message.includes("OPENAI_API_KEY") ? 500 : 502 },
      )
    }
    // Update the reservation with the real analysis. The row is already
    // counted against the user's quota.
    await updateReservation("gig_analyses", reservationId, { analysis })
    // Bill the credit (monthly bucket first, topup overflow second).
    await chargeCredit(user.id)
  }

  // 4. Run prediction.
  let prediction: ConversionPrediction
  try {
    prediction = await predictConversionWithLLM(scraped, analysis)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to predict conversion"
    return NextResponse.json(
      { error: message, stage: "predict" },
      { status: message.includes("OPENAI_API_KEY") ? 500 : 502 },
    )
  }

  return NextResponse.json(
    {
      url,
      scraped,
      analysis,
      prediction,
      analysisCached,
    },
    { status: 200 },
  )
}
