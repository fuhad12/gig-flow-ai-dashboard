import { NextResponse } from "next/server"
import { z } from "zod"

import { createSupabaseServer } from "@/lib/supabase/server"
import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { getProfile, nicheLimitForTier } from "@/lib/quota"
import { NICHE_SLUG_REGEX } from "@/lib/niches"

export const runtime = "nodejs"

/**
 * Read / update the user's pinned niches + skill tags.
 *
 *   GET  /api/profile/niches
 *     → { selectedNiches: string[], skillTags: string[],
 *         nicheLimit: number, skillTagLimit: number,
 *         tier: "free" | "pro" | "agency" }
 *
 *   PATCH /api/profile/niches
 *     body: { selectedNiches?: string[], skillTags?: string[] }
 *     → echoes the persisted state.
 *
 * Per-tier caps:
 *   niches:     free → 3, pro → 6, agency → 12
 *   skillTags:  free → 5, pro → 10, agency → 20
 *
 * Server-side enforcement (cap + slug whitelist + per-tag length) is the
 * source of truth — the UI mirrors the same rules for instant feedback
 * but a malicious client can't bypass them.
 */

const MAX_SKILL_TAG_LENGTH = 40

// Per-tier skill tag caps. Mirrors `nicheLimitForTier` in lib/quota.ts —
// kept here because skill tags are local to this route's domain.
function skillTagLimitForTier(tier: "free" | "pro" | "agency"): number {
  if (tier === "agency") return 20
  if (tier === "pro") return 10
  return 5
}

// `skillTags` accepts `null` so the client can clear the entire array;
// it's normalized to `[]` below.
const BodySchema = z.object({
  selectedNiches: z.array(z.string()).max(20).optional(),
  skillTags: z.array(z.string()).max(20).nullable().optional(),
})

export async function GET() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
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

  const profile = await getProfile(user.id)
  return NextResponse.json(
    {
      selectedNiches: profile.selectedNiches,
      skillTags: profile.skillTags,
      tier: profile.tier,
      nicheLimit: nicheLimitForTier(profile.tier),
      skillTagLimit: skillTagLimitForTier(profile.tier),
    },
    { status: 200 },
  )
}

export async function PATCH(req: Request) {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Build the update payload field-by-field so we don't overwrite a column
  // the client didn't pass. `selectedNiches: undefined` → leave unchanged.
  const profile = await getProfile(user.id)
  const nicheLimit = nicheLimitForTier(profile.tier)
  const skillTagLimit = skillTagLimitForTier(profile.tier)

  const updates: Record<string, unknown> = {
    onboarded_at: new Date().toISOString(),
  }

  if (parsed.data.selectedNiches !== undefined) {
    // Drop duplicates, validate slug format, cap to tier limit. We accept
    // ANY well-formed slug — including custom user-defined niches that
    // aren't in the predefined catalog — because Fiverr has long-tail
    // verticals we don't curate (tarot reading, resume writing, etc.).
    // `NICHE_SLUG_REGEX` is the source of truth for what's allowed.
    //
    // Preserves user-provided order so the first slug becomes the
    // "primary" niche everywhere in the app.
    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const slug of parsed.data.selectedNiches) {
      const s = slug.trim().toLowerCase()
      if (!s || seen.has(s) || !NICHE_SLUG_REGEX.test(s)) continue
      seen.add(s)
      cleaned.push(s)
      if (cleaned.length >= nicheLimit) break
    }
    updates.selected_niches = cleaned
  }

  if (parsed.data.skillTags !== undefined) {
    // Normalize: trim, lowercase, dedupe, drop empties, drop overlong
    // tags, cap to tier limit. Preserves user-provided order so the
    // first tag is treated as the primary skill hint.
    const raw = parsed.data.skillTags ?? []
    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const tag of raw) {
      const t = tag.trim().toLowerCase().slice(0, MAX_SKILL_TAG_LENGTH)
      if (!t || seen.has(t)) continue
      seen.add(t)
      cleaned.push(t)
      if (cleaned.length >= skillTagLimit) break
    }
    updates.skill_tags = cleaned
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase admin not configured" },
      { status: 500 },
    )
  }

  // Upsert (not update) so the row gets created if it's missing. The
  // `handle_new_user` trigger creates a profile row on every NEW signup,
  // but users who signed up BEFORE that trigger was deployed have an
  // auth.users row with no matching profiles row. A plain `.update()`
  // silently affects 0 rows in that case — the API returned 200, the
  // UI flashed "Saved", but nothing was persisted. Upsert closes the gap.
  //
  // `email` is included because the column is `not null` in the schema;
  // on the UPDATE branch of the upsert it's harmlessly overwritten with
  // the same value Supabase Auth already has.
  const { error } = await admin
    .from("profiles")
    .upsert(
      { id: user.id, email: user.email ?? "", ...updates },
      { onConflict: "id" },
    )
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const fresh = await getProfile(user.id)
  return NextResponse.json(
    {
      selectedNiches: fresh.selectedNiches,
      skillTags: fresh.skillTags,
      tier: fresh.tier,
      nicheLimit: nicheLimitForTier(fresh.tier),
      skillTagLimit: skillTagLimitForTier(fresh.tier),
    },
    { status: 200 },
  )
}
