import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import {
  createFlutterwavePayment,
  getFlutterwaveCurrency,
  getSiteUrl,
  getTopupPack,
  rememberBillingEmail,
  resolveTopupAmountCents,
  TOPUP_PACKS,
} from "@/lib/stripe"

export const runtime = "nodejs"

/**
 * One-time credit pack purchases via Flutterwave Standard (no payment plan).
 */

const BodySchema = z.object({
  packId: z.enum(TOPUP_PACKS.map((p) => p.id) as [string, ...string[]]),
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
      { error: "You must be signed in to buy credits" },
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

  const pack = getTopupPack(parsed.data.packId)
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 400 })
  }

  try {
    const siteUrl = getSiteUrl()
    const currency = getFlutterwaveCurrency()
    const amount = resolveTopupAmountCents(pack) / 100
    const txRef = `jf_topup_${user.id}_${pack.id}_${Date.now()}`

    await rememberBillingEmail(user.id, user.email)

    const { link } = await createFlutterwavePayment({
      txRef,
      amount,
      currency,
      redirectUrl: `${siteUrl}/?topup=success`,
      customerEmail: user.email,
      title: "JobFlow AI",
      description: `Credit pack · ${pack.label}`,
      meta: {
        type: "topup",
        user_id: user.id,
        pack_id: pack.id,
        credits: String(pack.credits),
      },
    })

    return NextResponse.json({ url: link }, { status: 200 })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create topup session"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
