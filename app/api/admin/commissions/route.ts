import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const adminAuth = await requireAdmin()
  if (!adminAuth.ok) {
    return NextResponse.json(
      { error: adminAuth.error },
      { status: adminAuth.status },
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
  const influencerId = url.searchParams.get("influencer_id")

  let query = supabase
    .from("referral_commissions")
    .select(
      "id, influencer_id, user_id, stripe_invoice_id, amount_cents, invoice_amount_cents, currency, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200)

  if (influencerId) {
    query = query.eq("influencer_id", influencerId)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const userIds = [
    ...new Set((data ?? []).map((r) => r.user_id as string).filter(Boolean)),
  ]
  const emailByUser: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds)
    for (const p of profiles ?? []) {
      emailByUser[p.id as string] = (p.email as string) ?? ""
    }
  }

  const commissions = (data ?? []).map((r) => ({
    id: r.id as string,
    influencerId: r.influencer_id as string,
    userId: r.user_id as string,
    userEmail: emailByUser[r.user_id as string] ?? "",
    stripeInvoiceId: r.stripe_invoice_id as string,
    amountCents: r.amount_cents as number,
    invoiceAmountCents: r.invoice_amount_cents as number,
    currency: r.currency as string,
    status: r.status as string,
    createdAt: r.created_at as string,
  }))

  return NextResponse.json({ commissions })
}
