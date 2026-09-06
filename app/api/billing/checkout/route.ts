import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import {
  cadenceOf,
  createFlutterwavePayment,
  getFlutterwaveCurrency,
  getFlutterwavePlanId,
  getSiteUrl,
  PLAN_AMOUNTS_USD,
  rememberBillingEmail,
  tierOf,
  type Plan,
} from "@/lib/stripe"

export const runtime = "nodejs"

const PLAN_ALIASES: Record<string, Plan> = {
  monthly: "pro-monthly",
  yearly: "pro-yearly",
  "pro-monthly": "pro-monthly",
  "pro-yearly": "pro-yearly",
  "agency-monthly": "agency-monthly",
  "agency-yearly": "agency-yearly",
}

const BodySchema = z.object({
  plan: z.enum([
    "monthly",
    "yearly",
    "pro-monthly",
    "pro-yearly",
    "agency-monthly",
    "agency-yearly",
  ]),
})

export async function POST(req: Request) {
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
  if (!user || !user.email) {
    return NextResponse.json(
      { error: "You must be signed in to upgrade" },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const plan = PLAN_ALIASES[parsed.data.plan]
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 })
  }

  try {
    const planId = getFlutterwavePlanId(plan)
    const siteUrl = getSiteUrl()
    const currency = getFlutterwaveCurrency()
    const amount = PLAN_AMOUNTS_USD[plan]
    const txRef = `jf_sub_${user.id}_${plan}_${Date.now()}`

    await rememberBillingEmail(user.id, user.email)

    const { link } = await createFlutterwavePayment({
      txRef,
      amount,
      currency,
      redirectUrl: `${siteUrl}/?subscribed=success`,
      customerEmail: user.email,
      title: "JobFlow AI",
      description: `Subscribe · ${plan}`,
      paymentPlanId: planId,
      meta: {
        type: "subscription",
        user_id: user.id,
        plan,
        tier: tierOf(plan),
        cadence: cadenceOf(plan),
      },
    })

    return NextResponse.json({ url: link }, { status: 200 })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start checkout"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
