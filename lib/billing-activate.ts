/**
 * Activate subscriptions / top-ups after Flutterwave payment.
 * Used by webhook and by return-URL verification (confirm).
 */

import {
  getFlutterwaveSecretKey,
  getTopupPack,
  planForPrice,
  tierOf,
  type Plan,
} from "@/lib/stripe"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

const FLW_API = "https://api.flutterwave.com/v3"

const PLANS = new Set<Plan>([
  "pro-monthly",
  "pro-yearly",
  "agency-monthly",
  "agency-yearly",
])

export type FlwMeta = Record<string, unknown>

export interface FlwChargeData {
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

export function normalizeMeta(raw: FlwChargeData["meta"]): Record<string, string> {
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

/** Parse `jf_sub_{userId}_{plan}_{ts}` or `jf_topup_{userId}_{pack}_{ts}`. */
export function parseJobFlowTxRef(txRef: string | null | undefined): {
  kind: "subscription" | "topup" | null
  userId: string | null
  plan: Plan | null
  packId: string | null
} {
  if (!txRef) {
    return { kind: null, userId: null, plan: null, packId: null }
  }

  const sub = txRef.match(
    /^jf_sub_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(pro-monthly|pro-yearly|agency-monthly|agency-yearly)_(\d+)$/i,
  )
  if (sub) {
    const plan = sub[2].toLowerCase() as Plan
    return {
      kind: "subscription",
      userId: sub[1].toLowerCase(),
      plan: PLANS.has(plan) ? plan : null,
      packId: null,
    }
  }

  const topup = txRef.match(
    /^jf_topup_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([a-z0-9-]+)_(\d+)$/i,
  )
  if (topup) {
    return {
      kind: "topup",
      userId: topup[1].toLowerCase(),
      plan: null,
      packId: topup[2],
    }
  }

  return { kind: null, userId: null, plan: null, packId: null }
}

export async function resolveUserId(
  meta: Record<string, string>,
  data: FlwChargeData,
): Promise<string | null> {
  if (meta.user_id) return meta.user_id

  const fromRef = parseJobFlowTxRef(data.tx_ref).userId
  if (fromRef) return fromRef

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

export function resolvePlan(
  meta: Record<string, string>,
  data: FlwChargeData,
): Plan | null {
  if (meta.plan && PLANS.has(meta.plan as Plan)) {
    return meta.plan as Plan
  }
  const fromPrice = planForPrice(data.payment_plan)
  if (fromPrice) return fromPrice
  return parseJobFlowTxRef(data.tx_ref).plan
}

export async function verifyFlutterwaveTransaction(opts: {
  transactionId?: string | null
  txRef?: string | null
}): Promise<FlwChargeData | null> {
  const key = getFlutterwaveSecretKey()
  const id = opts.transactionId?.trim()
  const txRef = opts.txRef?.trim()

  let url: string | null = null
  if (id && /^\d+$/.test(id)) {
    url = `${FLW_API}/transactions/${id}/verify`
  } else if (txRef) {
    url = `${FLW_API}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`
  }
  if (!url) return null

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  })
  const json = (await res.json()) as {
    status?: string
    data?: FlwChargeData
    message?: string
  }

  if (!res.ok || json.status !== "success" || !json.data) {
    console.error("[flutterwave-verify] failed:", json.message ?? res.status)
    return null
  }

  return json.data
}

export async function activateFromFlutterwaveCharge(
  data: FlwChargeData,
): Promise<{ ok: boolean; reason?: string; kind?: string }> {
  const status = (data.status ?? "").toLowerCase()
  if (status && status !== "successful" && status !== "success") {
    return { ok: false, reason: `status_${status || "unknown"}` }
  }

  const meta = normalizeMeta(data.meta)
  const parsed = parseJobFlowTxRef(data.tx_ref)
  const type =
    meta.type ||
    parsed.kind ||
    (data.payment_plan ? "subscription" : "")

  if (type === "topup" || meta.pack_id || parsed.kind === "topup") {
    const result = await activateTopup(data, {
      ...meta,
      pack_id: meta.pack_id || parsed.packId || "",
      user_id: meta.user_id || parsed.userId || "",
    })
    return result
  }

  if (
    data.payment_plan ||
    type === "subscription" ||
    meta.plan ||
    parsed.kind === "subscription"
  ) {
    const result = await activateSubscription(data, meta)
    return result
  }

  return { ok: false, reason: "unknown_charge_type" }
}

async function activateSubscription(
  data: FlwChargeData,
  meta: Record<string, string>,
): Promise<{ ok: boolean; reason?: string; kind?: string }> {
  const admin = getSupabaseAdmin()
  if (!admin) return { ok: false, reason: "db_unavailable" }

  const userId = await resolveUserId(meta, data)
  if (!userId) {
    console.error("[billing-activate] no user for subscription", {
      tx_ref: data.tx_ref,
      email: data.customer?.email,
    })
    return { ok: false, reason: "no_user" }
  }

  const plan = resolvePlan(meta, data)
  if (!plan) {
    console.error(
      "[billing-activate] unknown plan",
      data.payment_plan,
      data.tx_ref,
    )
    return { ok: false, reason: "unknown_plan" }
  }

  const tier = tierOf(plan)
  const email = data.customer?.email?.toLowerCase() ?? null

  const { error } = await admin
    .from("profiles")
    .update({
      stripe_customer_id: email,
      stripe_subscription_id: data.flw_ref ?? String(data.id ?? ""),
      stripe_price_id: String(data.payment_plan ?? plan),
      subscription_status: "active",
      subscription_plan: plan,
      subscription_tier: tier,
    })
    .eq("id", userId)

  if (error) {
    console.error("[billing-activate] profile update failed:", error.message)
    return { ok: false, reason: "update_failed" }
  }

  if (tier === "pro") {
    await recordReferralCommission(userId, data)
  }

  return { ok: true, kind: "subscription" }
}

async function activateTopup(
  data: FlwChargeData,
  meta: Record<string, string>,
): Promise<{ ok: boolean; reason?: string; kind?: string }> {
  const admin = getSupabaseAdmin()
  if (!admin) return { ok: false, reason: "db_unavailable" }

  const userId = await resolveUserId(meta, data)
  const packId = meta.pack_id
  if (!userId || !packId) {
    return { ok: false, reason: "missing_user_or_pack" }
  }

  const pack = getTopupPack(packId)
  if (!pack) return { ok: false, reason: "unknown_pack" }

  const paymentKey =
    data.flw_ref ||
    (data.id != null ? `flw_${data.id}` : null) ||
    data.tx_ref
  if (!paymentKey) return { ok: false, reason: "missing_payment_id" }

  const { error } = await admin.from("credit_topups").insert({
    user_id: userId,
    pack_id: pack.id,
    credits_total: pack.credits,
    credits_remaining: pack.credits,
    stripe_payment_intent_id: paymentKey,
  })

  if (error) {
    if (error.code === "23505") {
      return { ok: true, kind: "topup", reason: "already_credited" }
    }
    console.error("[billing-activate] topup insert failed:", error.message)
    return { ok: false, reason: "insert_failed" }
  }

  return { ok: true, kind: "topup" }
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
      "[billing-activate] referral commission insert failed:",
      error.message,
    )
  }
}

/**
 * Verify Flutterwave payment and activate. Optionally restrict to a signed-in user.
 */
export async function confirmFlutterwaveReturn(opts: {
  transactionId?: string | null
  txRef?: string | null
  /** When set, only activate if the charge belongs to this user. */
  expectedUserId?: string | null
}): Promise<{ ok: boolean; reason?: string; kind?: string }> {
  const data = await verifyFlutterwaveTransaction({
    transactionId: opts.transactionId,
    txRef: opts.txRef,
  })
  if (!data) return { ok: false, reason: "verify_failed" }

  if (opts.expectedUserId) {
    const meta = normalizeMeta(data.meta)
    const owner = await resolveUserId(meta, data)
    if (owner && owner !== opts.expectedUserId) {
      return { ok: false, reason: "user_mismatch" }
    }
    // If tx_ref embeds user id, enforce it even when meta is empty.
    const fromRef = parseJobFlowTxRef(data.tx_ref).userId
    if (fromRef && fromRef !== opts.expectedUserId) {
      return { ok: false, reason: "user_mismatch" }
    }
  }

  return activateFromFlutterwaveCharge(data)
}
