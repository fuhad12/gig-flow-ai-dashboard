import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getTracked, removeTracked } from "@/lib/tracking"

export const runtime = "nodejs"

export async function DELETE(
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

  // Confirm ownership before deleting so we return a 404 instead of a silent
  // success for unknown ids.
  const existing = await getTracked(user.id, id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const ok = await removeTracked(user.id, id)
  if (!ok) {
    return NextResponse.json(
      { error: "Failed to remove tracked gig" },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}
