/**
 * Toggle / read the public-share state for a gig analysis.
 *
 *   GET  /api/share/:id   → current share state for an analysis the caller owns
 *   POST /api/share/:id   → body: { public: boolean } → enable/disable sharing
 *
 * All operations are gated by:
 *   1. Authenticated session (cookie-bound Supabase client).
 *   2. Ownership check inside `lib/sharing.ts` (analysis.user_id === auth.uid).
 *
 * Returns the resolved share URL alongside the slug so the UI can copy it
 * to the clipboard without reconstructing the host.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import {
  disableSharing,
  enableSharing,
  getShareState,
  type ShareState,
} from "@/lib/sharing"
import { getSiteUrl } from "@/lib/stripe"

export const runtime = "nodejs"

const BodySchema = z.object({
  public: z.boolean(),
})

interface ShareResponse extends ShareState {
  publicUrl: string | null
}

function toResponse(state: ShareState): ShareResponse {
  return {
    ...state,
    publicUrl: state.publicSlug
      ? `${getSiteUrl()}/audit/${state.publicSlug}`
      : null,
  }
}

async function requireUserId(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Supabase is not configured on the server" },
        { status: 500 },
      ),
    }
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You must be signed in" },
        { status: 401 },
      ),
    }
  }
  return { ok: true, userId: user.id }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const auth = await requireUserId()
  if (!auth.ok) return auth.response

  const state = await getShareState(id, auth.userId)
  if (!state) {
    return NextResponse.json(
      { error: "Analysis not found" },
      { status: 404 },
    )
  }
  return NextResponse.json(toResponse(state), { status: 200 })
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const auth = await requireUserId()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    )
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    )
  }

  try {
    const state = parsed.data.public
      ? await enableSharing(id, auth.userId)
      : await disableSharing(id, auth.userId)
    return NextResponse.json(toResponse(state), { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status =
      message === "Not your analysis"
        ? 403
        : message === "Analysis not found"
          ? 404
          : 500
    return NextResponse.json({ error: message }, { status })
  }
}
