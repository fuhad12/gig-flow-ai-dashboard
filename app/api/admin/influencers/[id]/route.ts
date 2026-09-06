import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin"
import { getSiteUrl } from "@/lib/stripe"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PatchSchema = z.object({
  active: z.boolean().optional(),
  commissionPct: z.number().min(0).max(100).optional(),
  name: z.string().trim().min(1).max(120).optional(),
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

  const updates: Record<string, unknown> = {}
  if (parsed.data.active !== undefined) updates.active = parsed.data.active
  if (parsed.data.commissionPct !== undefined) {
    updates.commission_pct = parsed.data.commissionPct
  }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin is not configured" },
      { status: 500 },
    )
  }

  const { data, error } = await supabase
    .from("influencers")
    .update(updates)
    .eq("id", id)
    .select("id, code, name, email, commission_pct, active, created_at")
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Influencer not found" }, { status: 404 })
  }

  const site = getSiteUrl()
  return NextResponse.json({
    influencer: {
      id: data.id,
      code: data.code,
      name: data.name,
      email: data.email,
      commissionPct: Number(data.commission_pct),
      active: Boolean(data.active),
      createdAt: data.created_at,
      referralUrl: `${site}/r/${data.code}`,
    },
  })
}
