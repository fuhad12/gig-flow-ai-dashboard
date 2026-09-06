/**
 * Server-side helpers for the "shareable public audit link" feature.
 *
 * Sharing model:
 *   - Every gig_analyses row owns an OPTIONAL `public_slug`.
 *   - When `public_slug is not null` the row is publicly readable
 *     (RLS policy in migration 0007). The slug doubles as the URL token.
 *   - "Unshare" simply nulls the slug. We keep the row + history so the
 *     user can re-enable sharing later without recreating it.
 *
 * Slug format: 10 chars of url-safe base62 (≈ 5.9 × 10¹⁷ values). Collisions
 * are astronomically unlikely but we still re-try once on insert conflict.
 */

import { randomBytes } from "crypto"

import { getSupabaseAdmin } from "@/lib/supabase/admin"
import type { GigAnalysis, ScrapedGig } from "@/lib/analysis-types"

export interface SharedAnalysis {
  id: string
  url: string
  scraped: ScrapedGig
  analysis: GigAnalysis
  createdAt: string
  sharedAt: string | null
  slug: string
}

export interface ShareState {
  publicSlug: string | null
  sharedAt: string | null
}

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** Cryptographically random base62 slug, 10 chars. */
export function generateSlug(length = 10): string {
  const bytes = randomBytes(length)
  let out = ""
  for (let i = 0; i < length; i++) {
    // Modulo bias is negligible at this length / alphabet size and we don't
    // need it cryptographically uniform — just unguessable.
    out += ALPHABET[bytes[i]! % ALPHABET.length]
  }
  return out
}

/**
 * Enable sharing on an analysis the caller owns. Idempotent — returns the
 * existing slug if the row is already public.
 *
 * Throws if the analysis doesn't exist or doesn't belong to `userId`.
 */
export async function enableSharing(
  analysisId: string,
  userId: string,
): Promise<ShareState> {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error("Supabase admin client unavailable")

  // 1. Load + ownership check.
  const { data: existing, error: loadErr } = await supabase
    .from("gig_analyses")
    .select("user_id, public_slug, shared_at")
    .eq("id", analysisId)
    .maybeSingle()
  if (loadErr) throw new Error(`Lookup failed: ${loadErr.message}`)
  if (!existing) throw new Error("Analysis not found")
  if (existing.user_id !== userId) throw new Error("Not your analysis")

  if (existing.public_slug) {
    return {
      publicSlug: existing.public_slug as string,
      sharedAt: existing.shared_at as string | null,
    }
  }

  // 2. Generate slug with one retry on the (vanishingly unlikely) collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = generateSlug()
    const sharedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from("gig_analyses")
      .update({ public_slug: slug, shared_at: sharedAt })
      .eq("id", analysisId)
      .select("public_slug, shared_at")
      .maybeSingle()
    if (!error && data) {
      return {
        publicSlug: data.public_slug as string,
        sharedAt: data.shared_at as string,
      }
    }
    // 23505 = unique_violation in Postgres.
    if (error && !error.message.includes("duplicate")) {
      throw new Error(`Failed to enable sharing: ${error.message}`)
    }
  }
  throw new Error("Failed to allocate a unique share slug after retries")
}

/** Disable sharing — null out the slug. Idempotent. */
export async function disableSharing(
  analysisId: string,
  userId: string,
): Promise<ShareState> {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error("Supabase admin client unavailable")

  const { data: existing, error: loadErr } = await supabase
    .from("gig_analyses")
    .select("user_id")
    .eq("id", analysisId)
    .maybeSingle()
  if (loadErr) throw new Error(`Lookup failed: ${loadErr.message}`)
  if (!existing) throw new Error("Analysis not found")
  if (existing.user_id !== userId) throw new Error("Not your analysis")

  const { error } = await supabase
    .from("gig_analyses")
    .update({ public_slug: null, shared_at: null })
    .eq("id", analysisId)
  if (error) throw new Error(`Failed to disable sharing: ${error.message}`)

  return { publicSlug: null, sharedAt: null }
}

/**
 * Fetch a shared analysis by its public slug. Returns null if no public row
 * matches (the page should 404).
 *
 * Uses the admin client because the public RLS policy is the one that
 * permits the read — going through the admin client is just a convenience
 * so we don't have to mint a no-cookie anon client here.
 */
export async function getSharedAnalysis(
  slug: string,
): Promise<SharedAnalysis | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("gig_analyses")
    .select("id, url, scraped, analysis, created_at, shared_at, public_slug")
    .eq("public_slug", slug)
    .maybeSingle()
  if (error || !data) return null

  return {
    id: data.id as string,
    url: data.url as string,
    scraped: data.scraped as ScrapedGig,
    analysis: data.analysis as GigAnalysis,
    createdAt: data.created_at as string,
    sharedAt: data.shared_at as string | null,
    slug: data.public_slug as string,
  }
}

/** Read the current sharing state for an analysis the caller owns. */
export async function getShareState(
  analysisId: string,
  userId: string,
): Promise<ShareState | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return null
  const { data } = await supabase
    .from("gig_analyses")
    .select("user_id, public_slug, shared_at")
    .eq("id", analysisId)
    .maybeSingle()
  if (!data || data.user_id !== userId) return null
  return {
    publicSlug: (data.public_slug as string | null) ?? null,
    sharedAt: (data.shared_at as string | null) ?? null,
  }
}
