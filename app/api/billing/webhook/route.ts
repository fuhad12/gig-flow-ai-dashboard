import { NextResponse } from "next/server"

import {
  activateFromFlutterwaveCharge,
  type FlwChargeData,
  normalizeMeta,
  resolveUserId,
} from "@/lib/billing-activate"
import { getFlutterwaveSecretHash } from "@/lib/stripe"
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
      await activateFromFlutterwaveCharge(body.data ?? {})
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

async function handleSubscriptionCancelled(data: FlwChargeData) {
  const admin = getSupabaseAdmin()
  if (!admin) return

  const email = data.customer?.email?.toLowerCase()
  const meta = normalizeMeta(data.meta)
  let userId: string | null = meta.user_id || null

  if (!userId) {
    userId = await resolveUserId(meta, data)
  }

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
