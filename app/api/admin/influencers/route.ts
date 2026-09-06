import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin"
import {
  isValidReferralCode,
  normalizeInfluencerEmail,
  normalizeReferralCode,
} from "@/lib/referral"
import { getSiteUrl } from "@/lib/stripe"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  code: z.string().trim().min(2).max(32),
  commissionPct: z.number().min(0).max(100).optional().default(20),
})

export async function GET() {
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

  const { data, error } = await supabase
    .from("influencers")
    .select("id, code, name, email, commission_pct, active, created_at")
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const site = getSiteUrl()
  const influencers = (data ?? []).map((row) => ({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    email: row.email as string,
    commissionPct: Number(row.commission_pct),
    active: Boolean(row.active),
    createdAt: row.created_at as string,
    referralUrl: `${site}/r/${row.code}`,
  }))

  return NextResponse.json({ influencers })
}

export async function POST(req: Request) {
  const adminAuth = await requireAdmin()
  if (!adminAuth.ok) {
    return NextResponse.json(
      { error: adminAuth.error },
      { status: adminAuth.status },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const code = normalizeReferralCode(parsed.data.code)
  if (!isValidReferralCode(code)) {
    return NextResponse.json(
      {
        error:
          "Code must be 2–32 chars: lowercase letters, numbers, hyphens (not starting/ending with hyphen).",
      },
      { status: 400 },
    )
  }

  const email = normalizeInfluencerEmail(parsed.data.email)
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin is not configured" },
      { status: 500 },
    )
  }

  const { data, error } = await supabase
    .from("influencers")
    .insert({
      name: parsed.data.name.trim(),
      email,
      code,
      commission_pct: parsed.data.commissionPct,
      active: true,
    })
    .select("id, code, name, email, commission_pct, active, created_at")
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "An influencer with that email or code already exists" },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const site = getSiteUrl()
  return NextResponse.json(
    {
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
    },
    { status: 201 },
  )
}
