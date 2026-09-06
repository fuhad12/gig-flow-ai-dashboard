/**
 * Single-keyword operations.
 *
 *   GET    /api/tracking/keywords/:kid          → full snapshot history
 *   DELETE /api/tracking/keywords/:kid          → remove keyword
 *   POST   /api/tracking/keywords/:kid/refresh  → re-check rank now
 *
 * (POST is on a separate sub-route so middleware/cron rules remain simple.)
 */

import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import {
  getKeyword,
  listSnapshots,
  removeKeyword,
} from "@/lib/serp-tracking"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ kid: string }> },
) {
  const { kid } = await ctx.params
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

  const found = await getKeyword(user.id, kid)
  if (!found) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const snapshots = await listSnapshots(kid)
  return NextResponse.json(
    { keyword: found.keyword, snapshots },
    { status: 200 },
  )
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ kid: string }> },
) {
  const { kid } = await ctx.params
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

  const ok = await removeKeyword(user.id, kid)
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}
