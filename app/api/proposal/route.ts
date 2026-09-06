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
import { writeUpworkProposal } from "@/lib/llm/write-proposal"
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit"
import { getNicheDisplayName } from "@/lib/niches"

export const runtime = "nodejs"
export const maxDuration = 90

const PROPOSAL_RATE_LIMIT = parseInt(
  process.env.PROPOSAL_RATE_LIMIT_PER_HOUR ?? "10",
  10,
)
const PROPOSAL_RATE_WINDOW_MS = 60 * 60 * 1000

const RequestSchema = z.object({
  jobText: z
    .string()
    .trim()
    .min(40, "Paste at least a short job description")
    .max(8000),
  jobUrl: z.string().trim().url().optional().or(z.literal("")),
  // Profile fields are optional — server fills from Settings niches/skills.
  niche: z.string().trim().max(100).optional().default(""),
  skills: z.string().trim().max(500).optional().default(""),
  tools: z.string().trim().max(300).optional().default(""),
  experience: z.string().trim().max(500).optional().default(""),
  tone: z
    .enum(["professional", "friendly", "direct"])
    .optional()
    .default("professional"),
  bidHint: z.number().min(5).max(100_000).optional(),
})

function buildSkillsFromTags(tags: string[]): string {
  if (tags.length === 0) return ""
  if (tags.length === 1) {
    return `I deliver ${tags[0]} — production-ready work tailored to the brief.`
  }
  const head = tags.slice(0, -1).join(", ")
  const last = tags[tags.length - 1]
  return `I deliver ${head}, and ${last} — production-ready work tailored to the brief.`
}

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
    key: `${ip}:proposal`,
    limit: PROPOSAL_RATE_LIMIT,
    windowMs: PROPOSAL_RATE_WINDOW_MS,
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
      { error: "You must be signed in to write a proposal" },
      { status: 401 },
    )
  }

  // Soft pre-check for a friendly 402. Authoritative gate is reserve below.
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("selected_niches, skill_tags")
    .eq("id", user.id)
    .maybeSingle()

  const niches = Array.isArray(profile?.selected_niches)
    ? (profile.selected_niches as string[]).filter(Boolean)
    : []
  const skillTags = Array.isArray(profile?.skill_tags)
    ? (profile.skill_tags as string[]).filter(Boolean)
    : []

  const data = parsed.data
  const niche =
    data.niche.trim() ||
    (niches[0] ? getNicheDisplayName(niches[0]) : "") ||
    "General freelance"
  const skills =
    data.skills.trim() ||
    buildSkillsFromTags(skillTags) ||
    "I deliver production-ready work matched to the client's brief."
  const tools = data.tools.trim() || skillTags.join(", ") || undefined
  const experience = data.experience.trim() || undefined

  // Meter against the shared AI credit pool (same as analyze/generate).
  // Inserts a gig_generations row BEFORE the LLM so usage actually counts —
  // chargeCredit alone is a no-op without a consumption row.
  let reservationId: string | null = null
  try {
    reservationId = await reserveCreditSlot({
      userId: user.id,
      kind: "generation",
      payload: {
        niche: `upwork-proposal:${niche}`.slice(0, 200),
        generation: { kind: "upwork_proposal", pending: true },
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
    const proposal = await writeUpworkProposal({
      jobText: data.jobText,
      jobUrl: data.jobUrl || undefined,
      niche,
      skills,
      tools,
      experience,
      tone: data.tone,
      bidHint: data.bidHint,
    })

    // Persist the proposal on the metering row (no Fiverr `title` field so
    // the Generator "Saved drafts" list won't treat this as a gig draft).
    await updateReservation("gig_generations", reservationId, {
      generation: {
        kind: "upwork_proposal",
        niche,
        jobUrl: data.jobUrl || null,
        ...proposal,
      },
    })

    await chargeCredit(user.id)

    const updatedQuota = await getQuotaStatus(user.id)

    return NextResponse.json(
      { proposal, quota: updatedQuota },
      { status: 200 },
    )
  } catch (err) {
    await releaseReservation("gig_generations", reservationId)
    const message =
      err instanceof Error ? err.message : "Failed to write proposal"
    const isCapacity =
      /\b503\b/.test(message) ||
      /high demand/i.test(message) ||
      /temporarily overloaded/i.test(message)
    return NextResponse.json(
      { error: message, stage: "proposal" },
      { status: isCapacity ? 503 : 502 },
    )
  }
}
