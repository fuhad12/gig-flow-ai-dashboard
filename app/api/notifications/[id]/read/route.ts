/**
 * POST /api/notifications/[id]/read
 *
 * Marks a single notification as read. Returns 200 on success,
 * 404 if the row doesn't exist (or doesn't belong to the user — RLS
 * masks the difference, which is fine here).
 */

import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { markRead } from "@/lib/notifications"

export const runtime = "nodejs"

export async function POST(
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

  const ok = await markRead(supabase, id)
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
}
