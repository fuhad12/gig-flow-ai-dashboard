import { NextResponse } from "next/server"

import {
  getFlutterwaveSecretHash,
  getTopupPack,
  planForPrice,
  tierOf,
  type Plan,
} from "@/lib/stripe"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"

/**
 * Flutterwave webhook.
 * Dashboard → Settings → Webhooks → URL:
 *   {NEXT_PUBLIC_SITE_URL}/api/billing/webhook
 * Secret hash → FLUTTERWAVE_SECRET_HASH (sent as verif-hash header).
 *
 * Events:
 *   - charge.completed  → activate subscription / credit top-up / referral commission
 *   - subscription.cancelled → mark profile free/canceled
 */

type FlwMeta = Record<string, unknown>

interface FlwChargeData {
  id?: number | string
  tx_ref?: string
  flw_ref?: string
  amount?: number
  currency?: string
  status?: string
  payment_plan?: number | string | null
  meta?: FlwMeta | FlwMeta[] | string
  customer?: { email?: string; id?: number | string }
}

function normalizeMeta(raw: FlwChargeData["meta"]): Record<string, string> {
  if (!raw) return {}
  if (typeof raw === "string") {
    try {
      return normalizeMeta(JSON.parse(raw) as FlwMeta)
    } catch {
      return {}
    }
  }
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const row of raw) {
      const k = String(
        (row as { metaname?: string; name?: string }).metaname ??
          (row as { name?: string }).name ??
          "",
      )
      const v = String(
        (row as { metavalue?: string; value?: string }).metavalue ??
          (row as { value?: string }).value ??
          "",
      )
      if (k) out[k] = v
    }
    return out
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v != null) out[k] = String(v)
  }
  return out
}

export async function POST(req: Request) {
  const secretHash = getFlutterwaveSecretHash()
  const headerHash = req.headers.get("verif-hash")

  if (secretHash) {
    if (!headerHash || headerHash !== secretHash) {
      return NextResponse.json({ error: "Invalid verif-hash" }, { status: 401 })
    }
  }

  let body: { event?: string; data?: FlwChargeData }
  try {
    body = (await req.json()) as { event?: string; data?: FlwChargeData }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const event = body.event ?? ""
    if (event === "charge.completed") {
      await handleChargeCompleted(body.data ?? {})
    } else if (
      event === "subscription.cancelled" ||
      event === "subscription.canceled"
    ) {
      await handleSubscriptionCancelled(body.data ?? {})
    }
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error("[flutterwave-webhook] handler failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "handler error" },
      { status: 500 },
    )
  }
}

async function handleChargeCompleted(data: FlwChargeData) {
  const status = (data.status ?? "").toLowerCase()
  if (status && status !== "successful" && status !== "success") {
    return
  }

  const meta = normalizeMeta(data.meta)
  const type = meta.type || (data.payment_plan ? "subscription" : "")

  if (type === "topup" || meta.pack_id) {
    await handleTopup(data, meta)
    return
  }

  // Subscription first charge or renewal
  if (data.payment_plan || type === "subscription" || meta.plan) {
    await handleSubscriptionCharge(data, meta)
  }
}

async function resolveUserId(
  meta: Record<string, string>,
  data: FlwChargeData,
): Promise<string | null> {
  if (meta.user_id) return meta.user_id

  const email = data.customer?.email?.toLowerCase()
  if (!email) return null

  const admin = getSupabaseAdmin()
  if (!admin) return null

  const { data: byEmail } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle()

  if (byEmail?.id) return byEmail.id as string

  const { data: byCustomer } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", email)
    .maybeSingle()

  return (byCustomer?.id as string | undefined) ?? null
}

async function handleSubscriptionCharge(
  data: FlwChargeData,
  meta: Record<string, string>,
) {
  const admin = getSupabaseAdmin()
  if (!admin) return

  const userId = await resolveUserId(meta, data)
  if (!userId) {
    console.error("[flutterwave-webhook] no user for subscription charge", {
      tx_ref: data.tx_ref,
      email: data.customer?.email,
    })
    return
  }

  let plan: Plan | null =
    (meta.plan as Plan | undefined) &&
    ["pro-monthly", "pro-yearly", "agency-monthly", "agency-yearly"].includes(
      meta.plan,
    )
      ? (meta.plan as Plan)
      : null

  if (!plan) {
    plan = planForPrice(data.payment_plan)
  }
  if (!plan) {
    console.error("[flutterwave-webhook] unknown payment_plan", data.payment_plan)
    return
  }

  const tier = tierOf(plan)
  const email = data.customer?.email?.toLowerCase() ?? null

  const { error } = await admin
    .from("profiles")
    .update({
      stripe_customer_id: email,
      stripe_subscription_id: data.flw_ref ?? String(data.id ?? ""),
      stripe_price_id: String(data.payment_plan ?? ""),
      subscription_status: "active",
      subscription_plan: plan,
      subscription_tier: tier,
    })
    .eq("id", userId)

  if (error) {
    console.error("[flutterwave-webhook] profile update failed:", error.message)
  }

  // Referral commission on every successful Pro charge (recurring).
  if (tier === "pro") {
    await recordReferralCommission(userId, data)
  }
}

async function handleTopup(
  data: FlwChargeData,
  meta: Record<string, string>,
) {
  const admin = getSupabaseAdmin()
  if (!admin) return

  const userId = await resolveUserId(meta, data)
  const packId = meta.pack_id
  if (!userId || !packId) {
    console.error("[flutterwave-webhook] topup missing user_id / pack_id", meta)
    return
  }

  const pack = getTopupPack(packId)
  if (!pack) {
    console.error("[flutterwave-webhook] unknown pack_id:", packId)
    return
  }

  const paymentKey =
    data.flw_ref ||
    (data.id != null ? `flw_${data.id}` : null) ||
    data.tx_ref
  if (!paymentKey) {
    console.error("[flutterwave-webhook] topup missing payment id")
    return
  }

  const { error } = await admin.from("credit_topups").insert({
    user_id: userId,
    pack_id: pack.id,
    credits_total: pack.credits,
    credits_remaining: pack.credits,
    stripe_payment_intent_id: paymentKey,
  })

  if (error) {
    if (error.code === "23505") {
      console.info(
        `[flutterwave-webhook] topup ${paymentKey} already credited — duplicate ignored`,
      )
      return
    }
    console.error("[flutterwave-webhook] topup insert failed:", error.message)
  }
}

async function recordReferralCommission(
  userId: string,
  data: FlwChargeData,
) {
  const admin = getSupabaseAdmin()
  if (!admin) return

  const amountPaid = Math.round((data.amount ?? 0) * 100)
  if (amountPaid <= 0) return

  const invoiceKey =
    data.flw_ref ||
    (data.id != null ? `flw_${data.id}` : null) ||
    data.tx_ref
  if (!invoiceKey) return

  const { data: profile } = await admin
    .from("profiles")
    .select("referred_by_influencer_id")
    .eq("id", userId)
    .maybeSingle()

  const influencerId = profile?.referred_by_influencer_id as
    | string
    | null
    | undefined
  if (!influencerId) return

  const { data: influencer } = await admin
    .from("influencers")
    .select("id, commission_pct, active")
    .eq("id", influencerId)
    .maybeSingle()

  if (!influencer || !influencer.active) return

  const pct = Number(influencer.commission_pct)
  if (!Number.isFinite(pct) || pct <= 0) return

  const amountCents = Math.round((amountPaid * pct) / 100)
  if (amountCents <= 0) return

  const { error } = await admin.from("referral_commissions").insert({
    influencer_id: influencerId,
    user_id: userId,
    stripe_invoice_id: invoiceKey,
    amount_cents: amountCents,
    invoice_amount_cents: amountPaid,
    currency: (data.currency ?? "usd").toLowerCase(),
    status: "pending",
  })

  if (error && error.code !== "23505") {
    console.error(
      "[flutterwave-webhook] referral commission insert failed:",
      error.message,
    )
  }
}

async function handleSubscriptionCancelled(data: FlwChargeData) {
  const admin = getSupabaseAdmin()
  if (!admin) return

  const email = data.customer?.email?.toLowerCase()
  const meta = normalizeMeta(data.meta)
  let userId: string | null = meta.user_id || null

  if (!userId && email) {
    const { data: byEmail } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()
    userId = (byEmail?.id as string | undefined) ?? null
  }
  if (!userId && email) {
    const { data: byCustomer } = await admin
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", email)
      .maybeSingle()
    userId = (byCustomer?.id as string | undefined) ?? null
  }

  if (!userId) {
    console.error("[flutterwave-webhook] cancel: no matching user")
    return
  }

  await admin
    .from("profiles")
    .update({
      subscription_status: "canceled",
      subscription_tier: "free",
    })
    .eq("id", userId)
}
