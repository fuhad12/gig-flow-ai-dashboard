import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { buildChangeLog, getTracked, listSnapshots } from "@/lib/tracking"

export const runtime = "nodejs"

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

  const gig = await getTracked(user.id, id)
  if (!gig) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const snapshots = await listSnapshots(id)
  const changes = buildChangeLog(snapshots)

  return NextResponse.json({ gig, snapshots, changes }, { status: 200 })
}
