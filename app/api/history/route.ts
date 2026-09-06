import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import type {
  AnalyzeResponse,
  GigAnalysis,
  ScrapedGig,
} from "@/lib/analysis-types"

export const runtime = "nodejs"

export interface HistoryItem extends AnalyzeResponse {
  id: string
}

/**
 * GET /api/history?limit=50
 * Returns the signed-in user's past gig analyses, most recent first.
 *
 * Uses the cookie-bound Supabase client (anon key), so RLS on `gig_analyses`
 * enforces that users can only see their own rows.
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
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 200)
    : 50

  const { data, error } = await supabase
    .from("gig_analyses")
    .select("id, url, scraped, analysis, created_at, public_slug")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json(
      { error: `Failed to load history: ${error.message}` },
      { status: 500 },
    )
  }

  const items: HistoryItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    url: row.url as string,
    scraped: row.scraped as ScrapedGig,
    analysis: row.analysis as GigAnalysis,
    cached: true,
    cachedAt: row.created_at as string,
    publicSlug: (row.public_slug as string | null) ?? null,
  }))

  return NextResponse.json({ items }, { status: 200 })
}
