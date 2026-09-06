import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import {
  chargeCredit,
  getQuotaStatus,
  releaseReservation,
  reserveCreditSlot,
  updateReservation,
} from "@/lib/quota"
import { optimizeSellerProfile } from "@/lib/llm/optimize-profile"
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit"
import { detectProfilePlatform } from "@/lib/profile-optimizer-types"
import { scrapeSellerProfile } from "@/lib/scrape-profile"

export const runtime = "nodejs"
export const maxDuration = 90

const PROFILE_RATE_LIMIT = parseInt(
  process.env.PROFILE_OPTIMIZE_RATE_LIMIT_PER_HOUR ?? "10",
  10,
)
const PROFILE_RATE_WINDOW_MS = 60 * 60 * 1000

const RequestSchema = z.object({
  profileUrl: z.string().trim().url("Paste a valid profile URL"),
  platform: z.enum(["fiverr", "upwork"]).optional(),
  tone: z
    .enum(["professional", "friendly", "direct"])
    .optional()
    .default("professional"),
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

  const ip = ipFromRequest(req)
  const rl = checkRateLimit({
    key: `${ip}:profile-optimize`,
    limit: PROFILE_RATE_LIMIT,
    windowMs: PROFILE_RATE_WINDOW_MS,
  })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: rl.message, retryAfterSec: rl.retryAfterSec },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      },
    )
  }

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
      { error: "You must be signed in to optimize a profile" },
      { status: 401 },
    )
  }

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

  const data = parsed.data
  const detected = detectProfilePlatform(data.profileUrl)
  const platform = data.platform ?? detected
  if (!platform) {
    return NextResponse.json(
      {
        error:
          "Could not detect platform from URL. Use a fiverr.com or upwork.com profile link, or pick Fiverr / Upwork explicitly.",
      },
      { status: 400 },
    )
  }
  if (detected && data.platform && detected !== data.platform) {
    return NextResponse.json(
      {
        error: `URL looks like ${detected}, but you selected ${data.platform}. Match them or clear the platform field.`,
      },
      { status: 400 },
    )
  }

  // Scrape before reserving credit so failed loads don't burn a slot.
  let scraped
  try {
    scraped = await scrapeSellerProfile(data.profileUrl, platform)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load that profile URL"
    return NextResponse.json(
      { error: message, stage: "profile-scrape" },
      { status: 422 },
    )
  }

  let reservationId: string | null = null
  try {
    reservationId = await reserveCreditSlot({
      userId: user.id,
      kind: "generation",
      payload: {
        niche: `profile-optimize:${platform}`.slice(0, 200),
        generation: { kind: "profile_optimizer", pending: true },
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Could not reserve an AI credit: ${message}` },
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
    const optimization = await optimizeSellerProfile({
      profileUrl: data.profileUrl,
      platform,
      profileText: scraped.profileText,
      tone: data.tone,
    })

    optimization.scraped = {
      displayName: scraped.displayName,
      headline: scraped.headline,
      overview: scraped.overview,
      skills: scraped.skills,
    }

    await updateReservation("gig_generations", reservationId, {
      generation: {
        kind: "profile_optimizer",
        profileUrl: data.profileUrl,
        ...optimization,
      },
    })

    await chargeCredit(user.id)
    const updatedQuota = await getQuotaStatus(user.id)

    return NextResponse.json(
      { optimization, quota: updatedQuota },
      { status: 200 },
    )
  } catch (err) {
    await releaseReservation("gig_generations", reservationId)
    const message =
      err instanceof Error ? err.message : "Failed to optimize profile"
    const isCapacity =
      /\b503\b/.test(message) ||
      /high demand/i.test(message) ||
      /temporarily overloaded/i.test(message)
    return NextResponse.json(
      { error: message, stage: "profile-optimize" },
      { status: isCapacity ? 503 : 502 },
    )
  }
}
