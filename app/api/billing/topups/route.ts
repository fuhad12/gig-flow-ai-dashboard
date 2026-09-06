import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"

export interface TopupHistoryItem {
  id: string
  packId: string
  creditsTotal: number
  creditsRemaining: number
  amountPaidCents: number
  currency: string
  createdAt: string
  expiresAt: string | null
}

export interface TopupHistoryResponse {
  topups: TopupHistoryItem[]
  totalRemaining: number
}

/**
 * Returns the signed-in user's top-up purchase history, newest first.
 *
 * Drives the "exactly what you paid for" audit panel in Settings: every
 * paid pack is listed with how many credits are still unspent, so the
 * user can verify their balance directly against their Stripe receipts.
 */
export async function GET() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 500 },
    )
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in" },
      { status: 401 },
    )
  }

  // We could rely on RLS here, but using the admin client makes the read
  // path symmetric with how the webhook inserts these rows — both go
  // through the service role.
  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase admin not configured" },
      { status: 500 },
    )
  }

  const { data, error } = await admin
    .from("credit_topups")
    .select(
      "id, pack_id, credits_total, credits_remaining, amount_paid_cents, currency, created_at, expires_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  const topups: TopupHistoryItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    packId: row.pack_id as string,
    creditsTotal: row.credits_total as number,
    creditsRemaining: row.credits_remaining as number,
    amountPaidCents: row.amount_paid_cents as number,
    currency: row.currency as string,
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
  }))
  const totalRemaining = topups.reduce((sum, t) => {
    if (t.expiresAt && new Date(t.expiresAt).getTime() <= now) return sum
    return sum + t.creditsRemaining
  }, 0)

  const body: TopupHistoryResponse = { topups, totalRemaining }
  return NextResponse.json(body, { status: 200 })
}
