import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin"
import type { AdminUserRow } from "@/lib/admin-types"
import {
  countMonthlyCreditsUsedByUsers,
  getTopupBalancesByUsers,
  monthlyLimitForTier,
  resolveTier,
} from "@/lib/quota"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export type { AdminUserRow }

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

type InfluencerEmbed = {
  id: string
  name: string
  code: string
} | null

export async function GET(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status },
    )
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin is not configured" },
      { status: 500 },
    )
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get("q") ?? "").trim()
  const page = Math.max(
    1,
    parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  )
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(
      1,
      parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) ||
        DEFAULT_LIMIT,
    ),
  )
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from("profiles")
    .select(
      `
      id,
      email,
      created_at,
      subscription_tier,
      subscription_status,
      subscription_plan,
      current_period_end,
      onboarded_at,
      referred_by_influencer_id,
      influencers:referred_by_influencer_id ( id, name, code )
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to)

  if (q) {
    const escaped = q.replace(/[%_]/g, "\\$&")
    query = query.ilike("email", `%${escaped}%`)
  }

  const { data, error, count } = await query
  if (error) {
    return NextResponse.json(
      { error: `Failed to list users: ${error.message}` },
      { status: 500 },
    )
  }

  const rows = data ?? []
  const userIds = rows.map((r) => r.id as string)

  const [usedMap, topupMap] = await Promise.all([
    countMonthlyCreditsUsedByUsers(userIds),
    getTopupBalancesByUsers(userIds),
  ])

  const users: AdminUserRow[] = rows.map((r) => {
    const status = (r.subscription_status as string | null) ?? null
    const storedTier = (r.subscription_tier as string | null) ?? null
    const tier = resolveTier(status, storedTier)
    const id = r.id as string
    const rawInfluencer = r.influencers as InfluencerEmbed | InfluencerEmbed[]
    const influencer = Array.isArray(rawInfluencer)
      ? (rawInfluencer[0] ?? null)
      : rawInfluencer

    return {
      id,
      email: (r.email as string) ?? "",
      createdAt: r.created_at as string,
      tier,
      billing: tier === "free" ? "free" : "paid",
      subscriptionStatus: status,
      subscriptionPlan: (r.subscription_plan as string | null) ?? null,
      currentPeriodEnd: (r.current_period_end as string | null) ?? null,
      onboardedAt: (r.onboarded_at as string | null) ?? null,
      creditsUsed: usedMap[id] ?? 0,
      creditLimit: monthlyLimitForTier(tier),
      topupBalance: topupMap[id] ?? 0,
      referredBy: influencer
        ? {
            id: influencer.id,
            name: influencer.name,
            code: influencer.code,
          }
        : null,
    }
  })

  return NextResponse.json({
    users,
    total: count ?? users.length,
    page,
    limit,
  })
}
