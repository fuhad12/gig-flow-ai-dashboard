import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PatchSchema = z.object({
  status: z.enum(["pending", "paid"]),
})

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const adminAuth = await requireAdmin()
  if (!adminAuth.ok) {
    return NextResponse.json(
      { error: adminAuth.error },
      { status: adminAuth.status },
    )
  }

  const { id } = await ctx.params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin is not configured" },
      { status: 500 },
    )
  }

  const { data, error } = await supabase
    .from("referral_commissions")
    .update({ status: parsed.data.status })
    .eq("id", id)
    .select(
      "id, influencer_id, user_id, stripe_invoice_id, amount_cents, invoice_amount_cents, currency, status, created_at",
    )
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Commission not found" }, { status: 404 })
  }

  return NextResponse.json({
    commission: {
      id: data.id,
      influencerId: data.influencer_id,
      userId: data.user_id,
      stripeInvoiceId: data.stripe_invoice_id,
      amountCents: data.amount_cents,
      invoiceAmountCents: data.invoice_amount_cents,
      currency: data.currency,
      status: data.status,
      createdAt: data.created_at,
    },
  })
}
