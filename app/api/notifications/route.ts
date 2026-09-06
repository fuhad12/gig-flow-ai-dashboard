/**
 * GET  /api/notifications        — list the signed-in user's recent
 *                                  notifications (newest first) + unread count.
 * POST /api/notifications/read   — mark every unread notification as read.
 *                                  Idempotent.
 */

import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { listNotifications } from "@/lib/notifications"
import type { NotificationListResponse } from "@/lib/notification-types"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured on the server" },
      { status: 500 },
    )
  }
  // Read-only polling endpoint — use the cookie-cached session instead
  // of the network-validated user. `getSession()` reads cookies locally
  // (no auth-server round-trip, ~200-400ms faster per poll); the DB
  // queries below are RLS-guarded by `auth.uid() = user_id`, so a
  // forged or expired JWT can't leak another user's rows — at worst
  // the offender sees an empty array. The two write routes
  // (/api/notifications/read, /api/notifications/[id]/read) deliberately
  // keep `getUser()` because mutations warrant stronger verification.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json(
      { error: "You must be signed in" },
      { status: 401 },
    )
  }

  const { items, unreadCount } = await listNotifications(supabase, {
    limit: 30,
  })
  return NextResponse.json(
    { items, unreadCount } satisfies NotificationListResponse,
    {
      status: 200,
      headers: {
        // The bell polls — don't let CDN edges cache stale data.
        "Cache-Control": "no-store",
      },
    },
  )
}
