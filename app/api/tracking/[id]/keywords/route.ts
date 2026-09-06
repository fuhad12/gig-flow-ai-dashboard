/**
 * List + add SERP keywords for a tracked gig.
 *
 *   GET  /api/tracking/:id/keywords    → list keywords with latest rank
 *   POST /api/tracking/:id/keywords    → add a keyword + run an initial check
 *
 * All operations are auth-gated and ownership-checked inside the lib layer.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import { addKeyword, listKeywords } from "@/lib/serp-tracking"

export const runtime = "nodejs"
// Initial keyword scrape can take 30-60s on Fiverr.
export const maxDuration = 90

const AddSchema = z.object({
  keyword: z.string().trim().min(2).max(80),
})

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
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
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in" },
      { status: 401 },
    )
  }

  const items = await listKeywords(user.id, id)
  return NextResponse.json({ items }, { status: 200 })
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
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
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in" },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    )
  }
  const parsed = AddSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    )
  }

  const result = await addKeyword(user.id, id, parsed.data.keyword)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(
    {
      keyword: result.keyword,
      snapshot: result.snapshot,
      ...(result.warning ? { warning: result.warning } : {}),
    },
    { status: 201 },
  )
}
