/**
 * POST /api/notifications/read
 *
 * Marks every unread notification belonging to the signed-in user as
 * read. Returns the number of rows updated. Idempotent — calling it
 * when there are no unread rows returns `{ updated: 0 }` and 200.
 */

import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { markAllRead } from "@/lib/notifications"

export const runtime = "nodejs"

export async function POST() {
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

  const updated = await markAllRead(supabase)
  return NextResponse.json({ ok: true, updated }, { status: 200 })
}
