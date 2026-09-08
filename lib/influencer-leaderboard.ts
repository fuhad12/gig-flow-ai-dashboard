/**
 * Influencer competition leaderboard — ranks partners by paid conversions,
 * then signups, then commission earned.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin"

export type LeaderboardPeriod = "all" | "month"

export interface LeaderboardEntry {
  rank: number
  id: string
  name: string
  code: string
  referredSignups: number
  paidConversions: number
  pendingCents: number
  paidCents: number
  totalEarnedCents: number
}

function monthStartIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString()
}

export async function buildInfluencerLeaderboard(
  period: LeaderboardPeriod = "all",
): Promise<{ entries: LeaderboardEntry[]; period: LeaderboardPeriod }> {
  const admin = getSupabaseAdmin()
  if (!admin) {
    return { entries: [], period }
  }

  const since = period === "month" ? monthStartIso() : null

  const { data: influencers, error: infErr } = await admin
    .from("influencers")
    .select("id, name, code, active")
    .eq("active", true)

  if (infErr || !influencers?.length) {
    return { entries: [], period }
  }

  const ids = influencers.map((i) => i.id as string)

  let profilesQuery = admin
    .from("profiles")
    .select("id, referred_by_influencer_id, created_at")
    .in("referred_by_influencer_id", ids)

  if (since) {
    profilesQuery = profilesQuery.gte("created_at", since)
  }

  let commissionsQuery = admin
    .from("referral_commissions")
    .select(
      "influencer_id, user_id, amount_cents, status, created_at",
    )
    .in("influencer_id", ids)

  if (since) {
    commissionsQuery = commissionsQuery.gte("created_at", since)
  }

  const [{ data: profiles }, { data: commissions }] = await Promise.all([
    profilesQuery,
    commissionsQuery,
  ])

  const signupCounts = new Map<string, number>()
  for (const p of profiles ?? []) {
    const id = p.referred_by_influencer_id as string
    signupCounts.set(id, (signupCounts.get(id) ?? 0) + 1)
  }

  const convertedUsers = new Map<string, Set<string>>()
  const pendingCents = new Map<string, number>()
  const paidCents = new Map<string, number>()

  for (const c of commissions ?? []) {
    const id = c.influencer_id as string
    const userId = c.user_id as string
    if (!convertedUsers.has(id)) convertedUsers.set(id, new Set())
    convertedUsers.get(id)!.add(userId)

    const amount = (c.amount_cents as number) ?? 0
    if (c.status === "paid") {
      paidCents.set(id, (paidCents.get(id) ?? 0) + amount)
    } else {
      pendingCents.set(id, (pendingCents.get(id) ?? 0) + amount)
    }
  }

  const unsorted = influencers.map((inf) => {
    const id = inf.id as string
    const pending = pendingCents.get(id) ?? 0
    const paid = paidCents.get(id) ?? 0
    return {
      id,
      name: inf.name as string,
      code: inf.code as string,
      referredSignups: signupCounts.get(id) ?? 0,
      paidConversions: convertedUsers.get(id)?.size ?? 0,
      pendingCents: pending,
      paidCents: paid,
      totalEarnedCents: pending + paid,
    }
  })

  unsorted.sort((a, b) => {
    if (b.paidConversions !== a.paidConversions) {
      return b.paidConversions - a.paidConversions
    }
    if (b.referredSignups !== a.referredSignups) {
      return b.referredSignups - a.referredSignups
    }
    if (b.totalEarnedCents !== a.totalEarnedCents) {
      return b.totalEarnedCents - a.totalEarnedCents
    }
    return a.name.localeCompare(b.name)
  })

  const entries: LeaderboardEntry[] = unsorted.map((row, i) => ({
    ...row,
    rank: i + 1,
  }))

  return { entries, period }
}
