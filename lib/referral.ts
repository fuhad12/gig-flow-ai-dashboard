/**
 * Influencer referral helpers — cookie name, code validation, attribution.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { isAdminEmail } from "@/lib/admin"

export const REF_COOKIE = "jf_ref"
export const REF_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 days

const CODE_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$|^[a-z0-9]{2,32}$/

export function normalizeReferralCode(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidReferralCode(raw: string): boolean {
  const code = normalizeReferralCode(raw)
  return CODE_RE.test(code)
}

export function normalizeInfluencerEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** True when this email has an influencers row (partner dashboard access). */
export async function isInfluencerEmail(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false
  const admin = getSupabaseAdmin()
  if (!admin) return false
  const normalized = normalizeInfluencerEmail(email)
  const { data } = await admin
    .from("influencers")
    .select("id, email")
    .ilike("email", normalized)
    .maybeSingle()
  if (!data) return false
  return normalizeInfluencerEmail(data.email as string) === normalized
}

export interface InfluencerRow {
  id: string
  code: string
  name: string
  email: string
  commission_pct: number
  active: boolean
  created_at: string
}

export async function getActiveInfluencerByCode(
  code: string,
): Promise<InfluencerRow | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null
  const normalized = normalizeReferralCode(code)
  if (!isValidReferralCode(normalized)) return null

  const { data, error } = await admin
    .from("influencers")
    .select("id, code, name, email, commission_pct, active, created_at")
    .eq("code", normalized)
    .eq("active", true)
    .maybeSingle()

  if (error || !data) return null
  return data as InfluencerRow
}

/**
 * First-touch: set referred_by_influencer_id if still null and influencer is active.
 * Returns true if attribution was applied (or already matched this influencer).
 * Platform admin emails (ADMIN_EMAILS) are never attributed and any prior
 * attribution on them is cleared so they stay off partner dashboards.
 */
export async function attributeReferralToUser(
  userId: string,
  code: string,
): Promise<{ attributed: boolean; reason?: string }> {
  const admin = getSupabaseAdmin()
  if (!admin) {
    return { attributed: false, reason: "db_unavailable" }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("referred_by_influencer_id, email")
    .eq("id", userId)
    .maybeSingle()

  const profileEmail = (profile?.email as string | null) ?? null
  if (isAdminEmail(profileEmail)) {
    if (profile?.referred_by_influencer_id) {
      await admin
        .from("profiles")
        .update({ referred_by_influencer_id: null })
        .eq("id", userId)
    }
    return { attributed: false, reason: "admin_excluded" }
  }

  const influencer = await getActiveInfluencerByCode(code)
  if (!influencer) {
    return { attributed: false, reason: "invalid_or_inactive_code" }
  }

  const existing = profile?.referred_by_influencer_id as string | null | undefined
  if (existing) {
    return {
      attributed: existing === influencer.id,
      reason: existing === influencer.id ? "already_attributed" : "already_has_referrer",
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({ referred_by_influencer_id: influencer.id })
    .eq("id", userId)
    .is("referred_by_influencer_id", null)

  if (error) {
    console.error("[referral] attribute failed:", error.message)
    return { attributed: false, reason: "update_failed" }
  }

  return { attributed: true }
}
