import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import type { GigGeneration } from "@/lib/generation-types"

export const runtime = "nodejs"

/**
 * GET /api/generations?limit=20
 * Returns the signed-in user's AI-generated gig drafts (most recent first).
 * RLS on `gig_generations` scopes rows to the current user.
 */
export async function GET(req: Request) {
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

  const url = new URL(req.url)
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 100)
    : 20

  const { data, error } = await supabase
    .from("gig_generations")
    .select("id, niche, generation, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json(
      { error: `Failed to load generations: ${error.message}` },
      { status: 500 },
    )
  }

  const items = (data ?? [])
    .map((row) => {
      const generation = row.generation as GigGeneration & {
        kind?: string
        pending?: boolean
      } | null
      // Skip reservation placeholders and Upwork proposal metering rows.
      if (
        !generation ||
        typeof generation !== "object" ||
        generation.kind === "upwork_proposal" ||
        generation.kind === "profile_optimizer" ||
        generation.pending ||
        !generation.title ||
        String(generation.title).startsWith("[pending")
      ) {
        return null
      }
      return {
        id: row.id as string,
        niche: row.niche as string,
        generation,
        createdAt: row.created_at as string,
      }
    })
    .filter(Boolean)

  return NextResponse.json({ items }, { status: 200 })
}
