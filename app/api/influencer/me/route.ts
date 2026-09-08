import { NextResponse } from "next/server"

import { normalizeInfluencerEmail } from "@/lib/referral"
import { resolveTier } from "@/lib/quota"
import { getSiteUrl } from "@/lib/stripe"
import { createSupabaseServer } from "@/lib/supabase/server"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Auth is not configured" },
      { status: 500 },
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: "Database is not configured" },
      { status: 500 },
    )
  }

  const email = normalizeInfluencerEmail(user.email)
  const { data: influencer, error } = await admin
    .from("influencers")
    .select("id, code, name, email, commission_pct, active, created_at")
    .ilike("email", email)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!influencer) {
    return NextResponse.json(
      { error: "No influencer account for this email" },
      { status: 403 },
    )
  }
  if (normalizeInfluencerEmail(influencer.email as string) !== email) {
    return NextResponse.json(
      { error: "No influencer account for this email" },
      { status: 403 },
    )
  }

  const influencerId = influencer.id as string

  const [
    { count: referredCount },
    { data: referredProfiles },
    { data: commissions },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("referred_by_influencer_id", influencerId),
    admin
      .from("profiles")
      .select(
        "id, email, created_at, subscription_tier, subscription_status, subscription_plan",
      )
      .eq("referred_by_influencer_id", influencerId)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("referral_commissions")
      .select(
        "id, user_id, stripe_invoice_id, amount_cents, invoice_amount_cents, currency, status, created_at",
      )
      .eq("influencer_id", influencerId)
      .order("created_at", { ascending: false })
      .limit(100),
  ])

  const referred = referredProfiles ?? []
  const rows = commissions ?? []
  const pendingCents = rows
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + (r.amount_cents as number), 0)
  const paidCents = rows
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + (r.amount_cents as number), 0)

  // Unique referred users who generated at least one commission (Pro convert).
  const convertedUserIds = new Set(rows.map((r) => r.user_id as string))

  const site = getSiteUrl()

  return NextResponse.json({
    influencer: {
      id: influencerId,
      code: influencer.code,
      name: influencer.name,
      email: influencer.email,
      commissionPct: Number(influencer.commission_pct),
      active: Boolean(influencer.active),
      referralUrl: `${site}/r/${influencer.code}`,
    },
    stats: {
      referredSignups: referredCount ?? referred.length,
      proConversions: convertedUserIds.size,
      pendingCents,
      paidCents,
    },
    referredUsers: referred.map((r) => {
      const status = (r.subscription_status as string | null) ?? null
      const storedTier = (r.subscription_tier as string | null) ?? null
      const tier = resolveTier(status, storedTier)
      return {
        id: r.id as string,
        email: (r.email as string) ?? "",
        createdAt: r.created_at as string,
        tier,
        billing: tier === "free" ? ("free" as const) : ("paid" as const),
        subscriptionStatus: status,
        subscriptionPlan: (r.subscription_plan as string | null) ?? null,
      }
    }),
    commissions: rows.map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      stripeInvoiceId: r.stripe_invoice_id as string,
      amountCents: r.amount_cents as number,
      invoiceAmountCents: r.invoice_amount_cents as number,
      currency: r.currency as string,
      status: r.status as string,
      createdAt: r.created_at as string,
    })),
  })
}
