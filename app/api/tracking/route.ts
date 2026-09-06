import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import { addTracked, listTracked } from "@/lib/tracking"

export const runtime = "nodejs"
export const maxDuration = 90

const AddSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "url is required")
    .url("url must be a valid URL"),
  nickname: z.string().trim().max(80).optional(),
})

/** List the signed-in user's tracked gigs with their latest snapshot. */
export async function GET() {
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

  const items = await listTracked(user.id)
  return NextResponse.json({ items }, { status: 200 })
}

/** Start tracking a new gig. Captures an initial snapshot. */
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

  const result = await addTracked(
    user.id,
    parsed.data.url,
    parsed.data.nickname,
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(
    { gig: result.gig, snapshot: result.snapshot },
    { status: 201 },
  )
}
