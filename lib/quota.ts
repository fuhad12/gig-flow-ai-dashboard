import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { tierOf, type Plan, type Tier } from "@/lib/stripe"

const ANALYSES_TABLE = "gig_analyses"
const GENERATIONS_TABLE = "gig_generations"
const TOPUPS_TABLE = "credit_topups"

// ---------- Monthly limit configuration ----------

/**
 * Monthly "AI credit" budget per tier. Each gig analysis OR gig generation
 * burns one credit. Both endpoints draw from the same pool so the
 * generator can't be used as a free bypass of the analyze limit.
 *
 * Env var names are kept stable across the pre-Agency-tier API so existing
 * deployments don't break. New tiers introduce dedicated env vars.
 */
export const FREE_MONTHLY_SCAN_LIMIT = parseInt(
  process.env.FREE_MONTHLY_SCAN_LIMIT ?? "5",
  10,
)
/** Limit for the original "Pro" tier. (Legacy env var: `PREMIUM_MONTHLY_SCAN_LIMIT`.) */
export const PRO_MONTHLY_SCAN_LIMIT = parseInt(
  process.env.PRO_MONTHLY_SCAN_LIMIT ??
    process.env.PREMIUM_MONTHLY_SCAN_LIMIT ??
    "20",
  10,
)
/** Limit for the Agency tier. */
export const AGENCY_MONTHLY_SCAN_LIMIT = parseInt(
  process.env.AGENCY_MONTHLY_SCAN_LIMIT ?? "50",
  10,
)

/** Backwards-compat alias for code paths still referencing the old name. */
export const PREMIUM_MONTHLY_SCAN_LIMIT = PRO_MONTHLY_SCAN_LIMIT

export function monthlyLimitForTier(tier: Tier): number {
  switch (tier) {
    case "agency":
      return AGENCY_MONTHLY_SCAN_LIMIT
    case "pro":
      return PRO_MONTHLY_SCAN_LIMIT
    case "free":
    default:
      return FREE_MONTHLY_SCAN_LIMIT
  }
}

/**
 * Maximum number of tracked competitor gigs a user can persist at any one
 * time. Mirrors the limits advertised on the marketing landing page.
 *
 * Tier-aware as of the Agency rollout: Free sellers can track 1 gig (their
 * own), Pro sellers can watch a small competitive set, and Agency users
 * can monitor a larger portfolio.
 */
export const FREE_TRACKED_GIG_LIMIT = parseInt(
  process.env.FREE_TRACKED_GIG_LIMIT ?? "1",
  10,
)
export const PRO_TRACKED_GIG_LIMIT = parseInt(
  process.env.PRO_TRACKED_GIG_LIMIT ??
    // Legacy: `PREMIUM_TRACKED_GIG_LIMIT` used to cover both paid tiers.
    // We honor it as a fallback so existing deployments keep working,
    // but the default is the new Pro cap.
    process.env.PREMIUM_TRACKED_GIG_LIMIT ??
    "7",
  10,
)
export const AGENCY_TRACKED_GIG_LIMIT = parseInt(
  process.env.AGENCY_TRACKED_GIG_LIMIT ?? "15",
  10,
)

/** Backwards-compat alias — code paths that haven't migrated yet still
 *  read this. Points at the Pro cap because pre-Agency, "premium" meant
 *  one paid tier. */
export const PREMIUM_TRACKED_GIG_LIMIT = PRO_TRACKED_GIG_LIMIT

export function trackedGigLimitForTier(tier: Tier): number {
  switch (tier) {
    case "agency":
      return AGENCY_TRACKED_GIG_LIMIT
    case "pro":
      return PRO_TRACKED_GIG_LIMIT
    case "free":
    default:
      return FREE_TRACKED_GIG_LIMIT
  }
}

/**
 * Maximum number of niches a user can pin to their profile per tier.
 * Free sellers focus on 1-3; Pro/Agency users running multiple categories
 * get more room.
 */
export const FREE_NICHE_LIMIT = parseInt(
  process.env.FREE_NICHE_LIMIT ?? "3",
  10,
)
export const PRO_NICHE_LIMIT = parseInt(
  process.env.PRO_NICHE_LIMIT ?? "6",
  10,
)
export const AGENCY_NICHE_LIMIT = parseInt(
  process.env.AGENCY_NICHE_LIMIT ?? "12",
  10,
)

export function nicheLimitForTier(tier: Tier): number {
  switch (tier) {
    case "agency":
      return AGENCY_NICHE_LIMIT
    case "pro":
      return PRO_NICHE_LIMIT
    case "free":
    default:
      return FREE_NICHE_LIMIT
  }
}

// ---------- Profile snapshot ----------

export type SubscriptionPlan = Plan | null

export interface ProfileSnapshot {
  isPremium: boolean
  tier: Tier
  subscriptionStatus: string | null
  subscriptionPlan: SubscriptionPlan
  currentPeriodEnd: string | null
  /** Niche slugs the user explicitly pinned. Empty array if not configured yet. */
  selectedNiches: string[]
  /**
   * Chip-style skill tags describing what the user actually sells
   * ("logo designer", "next.js developer", "voiceover artist", …).
   * Stored as a normalized lowercase array in the DB. Used as context
   * hints in AI prompts so generated copy reflects the user's real
   * positioning rather than defaulting to AI/dev.
   *
   * Empty array means the user hasn't picked any tags yet; downstream
   * code falls back to niche-derived defaults.
   */
  skillTags: string[]
  /**
   * Timestamp of the first time this user saved (or explicitly
   * dismissed) the niche-selection step. NULL means they've never
   * interacted with onboarding — the dashboard uses this to decide
   * whether to auto-route them to Settings on signin.
   */
  onboardedAt: string | null
}

export interface QuotaStatus extends ProfileSnapshot {
  // ---- Monthly pool (resets each calendar month) ----
  /** Monthly credits already burned in the current UTC calendar month. */
  used: number
  /** Monthly allowance for the user's current tier. */
  limit: number
  /** Monthly credits still available before topups kick in. */
  monthlyRemaining: number

  // ---- Top-up pool (rolls forward across months) ----
  /** Sum of `credits_remaining` across the user's unexpired topup rows. */
  topupBalance: number

  // ---- Combined ----
  /** Total credits available right now (monthly remaining + topup balance). */
  remaining: number
  /** Whether the user can run an AI action at all. */
  allowed: boolean
  /** When the monthly pool resets. Topups are not affected by this date. */
  resetsAt: string
}

function startOfMonthIso(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  ).toISOString()
}

function startOfNextMonthIso(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  ).toISOString()
}

const PREMIUM_STATUSES = new Set(["active", "trialing"])

/**
 * Resolve the user's effective tier.
 *
 * Reads `subscription_tier` from `profiles` (set by the Stripe webhook).
 * If that column is missing — e.g. running against an older DB that
 * hasn't been migrated yet — we fall back to the legacy "premium iff
 * subscription_status is active" check and assume Pro.
 *
 * A canceled / past_due / unpaid subscription drops the user back to
 * free regardless of what `subscription_tier` says, so cancellations
 * take effect immediately rather than at the period end.
 */
export function resolveTier(
  status: string | null,
  storedTier: string | null,
): Tier {
  if (!status || !PREMIUM_STATUSES.has(status)) return "free"
  if (storedTier === "agency") return "agency"
  if (storedTier === "pro") return "pro"
  // Legacy rows from before migration 0011 may have a null tier even
  // though the subscription is active. Default to Pro for safety —
  // the webhook will repair the column on the next sync.
  return "pro"
}

export async function getProfile(userId: string): Promise<ProfileSnapshot> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return {
      isPremium: false,
      tier: "free",
      subscriptionStatus: null,
      subscriptionPlan: null,
      currentPeriodEnd: null,
      selectedNiches: [],
      skillTags: [],
      onboardedAt: null,
    }
  }

  const { data } = await supabase
    .from("profiles")
    .select(
      "subscription_status, subscription_plan, subscription_tier, current_period_end, selected_niches, skill_tags, onboarded_at",
    )
    .eq("id", userId)
    .maybeSingle()

  const status = (data?.subscription_status as string | null) ?? null
  const storedTier = (data?.subscription_tier as string | null) ?? null
  const tier = resolveTier(status, storedTier)

  return {
    isPremium: tier !== "free",
    tier,
    subscriptionStatus: status,
    subscriptionPlan: (data?.subscription_plan as SubscriptionPlan) ?? null,
    currentPeriodEnd: (data?.current_period_end as string | null) ?? null,
    selectedNiches:
      (data?.selected_niches as string[] | null | undefined) ?? [],
    skillTags:
      (data?.skill_tags as string[] | null | undefined) ?? [],
    onboardedAt: (data?.onboarded_at as string | null) ?? null,
  }
}

// ---------- Monthly consumption counting ----------

async function countRowsThisMonth(
  table: string,
  userId: string,
): Promise<number> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return 0

  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfMonthIso())

  if (error) {
    console.error(`[quota] count failed for ${table}:`, error.message)
    return 0
  }
  return count ?? 0
}

/**
 * Total AI credits the user has burned in the current calendar month
 * (analyses + generations combined). This is the RAW consumption count
 * — even after the monthly cap is exhausted and topups start covering
 * the overage, the count keeps climbing. The quota math below derives
 * "how much came from the monthly pool" vs "how much came from topups"
 * from this number + the topup balance.
 */
async function countCreditsUsedThisMonth(userId: string): Promise<number> {
  const [scans, generations] = await Promise.all([
    countRowsThisMonth(ANALYSES_TABLE, userId),
    countRowsThisMonth(GENERATIONS_TABLE, userId),
  ])
  return scans + generations
}

/**
 * Batch monthly credit usage for an admin user list (analyses + generations).
 * Returns a map of userId → used count for the current UTC month.
 */
export async function countMonthlyCreditsUsedByUsers(
  userIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const id of userIds) out[id] = 0
  if (userIds.length === 0) return out

  const supabase = getSupabaseAdmin()
  if (!supabase) return out

  const since = startOfMonthIso()

  const tally = (rows: { user_id: string | null }[] | null) => {
    for (const row of rows ?? []) {
      const id = row.user_id
      if (!id || !(id in out)) continue
      out[id] += 1
    }
  }

  const [analyses, generations] = await Promise.all([
    supabase
      .from(ANALYSES_TABLE)
      .select("user_id")
      .in("user_id", userIds)
      .gte("created_at", since),
    supabase
      .from(GENERATIONS_TABLE)
      .select("user_id")
      .in("user_id", userIds)
      .gte("created_at", since),
  ])

  if (analyses.error) {
    console.error("[quota] batch analyses count failed:", analyses.error.message)
  } else {
    tally(analyses.data as { user_id: string | null }[] | null)
  }
  if (generations.error) {
    console.error(
      "[quota] batch generations count failed:",
      generations.error.message,
    )
  } else {
    tally(generations.data as { user_id: string | null }[] | null)
  }

  return out
}

/**
 * Batch topup balances for an admin user list.
 */
export async function getTopupBalancesByUsers(
  userIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const id of userIds) out[id] = 0
  if (userIds.length === 0) return out

  const supabase = getSupabaseAdmin()
  if (!supabase) return out

  const { data, error } = await supabase
    .from(TOPUPS_TABLE)
    .select("user_id, credits_remaining, expires_at")
    .in("user_id", userIds)
    .gt("credits_remaining", 0)

  if (error) {
    console.error("[quota] batch topup balance failed:", error.message)
    return out
  }

  const now = Date.now()
  for (const row of data ?? []) {
    const id = (row as { user_id: string }).user_id
    if (!(id in out)) continue
    const expiresAt = (row as { expires_at: string | null }).expires_at
    if (expiresAt && new Date(expiresAt).getTime() <= now) continue
    out[id] +=
      (row as { credits_remaining: number }).credits_remaining ?? 0
  }
  return out
}

// ---------- Topup balance ----------

/**
 * Sum of unspent topup credits owned by this user. Topups roll forward
 * indefinitely (no expiry by default) so the balance accumulates until
 * spent.
 *
 * Each row in `credit_topups` represents one PURCHASE, not one credit.
 * `credits_remaining` is the live balance for that purchase, decremented
 * atomically by `decrement_oldest_topup` when the monthly pool is exhausted.
 */
export async function getTopupBalance(userId: string): Promise<number> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return 0
  const { data, error } = await supabase
    .from(TOPUPS_TABLE)
    .select("credits_remaining, expires_at")
    .eq("user_id", userId)
    .gt("credits_remaining", 0)
  if (error) {
    console.error("[quota] topup balance fetch failed:", error.message)
    return 0
  }
  const now = Date.now()
  return (data ?? []).reduce((sum, row) => {
    const expiresAt = (row as { expires_at: string | null }).expires_at
    if (expiresAt && new Date(expiresAt).getTime() <= now) return sum
    return (
      sum + ((row as { credits_remaining: number }).credits_remaining ?? 0)
    )
  }, 0)
}

// ---------- Public: quota snapshot ----------

/**
 * Read-only snapshot of the user's credit posture right now.
 *
 * The `used` field is "raw rows inserted into gig_analyses + gig_generations
 * this month" — it can exceed `limit` for users who have spilled into their
 * topup balance. `monthlyRemaining` clamps to >= 0 for display purposes.
 *
 * `allowed = monthlyRemaining + topupBalance > 0`. A user with 0 monthly
 * remaining but 5 topup credits is still allowed; the next AI call will
 * decrement a topup row instead of just inserting another consumption row.
 */
export async function getQuotaStatus(userId: string): Promise<QuotaStatus> {
  const [profile, used, topupBalance] = await Promise.all([
    getProfile(userId),
    countCreditsUsedThisMonth(userId),
    getTopupBalance(userId),
  ])

  const limit = monthlyLimitForTier(profile.tier)
  const monthlyRemaining = Math.max(0, limit - used)
  const remaining = monthlyRemaining + topupBalance

  return {
    ...profile,
    used,
    limit,
    monthlyRemaining,
    topupBalance,
    remaining,
    allowed: remaining > 0,
    resetsAt: startOfNextMonthIso(),
  }
}

// ---------- Public: atomic credit reservation ----------
//
// These helpers wrap the `reserve_credit_slot` Postgres RPC so the
// generate / analyze / predict routes can reserve a metering row BEFORE
// the slow LLM call. That:
//
//   1. Closes the TOCTOU race where two concurrent requests both passed
//      the pre-LLM `getQuotaStatus().allowed` check and both ran the
//      LLM, only one of them being metered.
//
//   2. Makes metering failures LOUD — if the insert can't happen (table
//      missing, RLS misconfig, admin client not configured) the route
//      returns 500 / 402 instead of silently handing back a free result.
//
// Workflow:
//   const reservationId = await reserveCreditSlot({ userId, kind: "generation", payload: { niche } })
//   if (!reservationId) return 402  // over budget
//   try {
//     const result = await callLLM()
//     await updateReservation("gig_generations", reservationId, { generation: result })
//     await chargeCredit(userId)        // bills monthly pool first, then topup
//   } catch (err) {
//     await releaseReservation("gig_generations", reservationId)
//     throw err
//   }

export type ReservableKind = "analysis" | "generation"
export type ReservationTable = "gig_analyses" | "gig_generations"

function tableForKind(kind: ReservableKind): ReservationTable {
  return kind === "analysis" ? ANALYSES_TABLE : GENERATIONS_TABLE
}

export interface ReserveOptions {
  userId: string
  kind: ReservableKind
  /**
   * Per-table column data the RPC INSERTs along with the user_id. The
   * shape depends on `kind`:
   *   analysis    → { url, scraped?, analysis? }
   *   generation  → { niche, generation? }
   * The optional jsonb fields default to `{}` server-side so the row
   * passes NOT NULL — the caller fills them in after the LLM returns.
   */
  payload: Record<string, unknown>
}

/**
 * Reserve a credit slot atomically. Returns the reservation row id when
 * the user has budget remaining, or `null` when they're over their
 * monthly + topup cap. Throws on infra failure (RPC not deployed, admin
 * client missing, etc.) — callers should surface that as a 500 so the
 * user isn't given a free result we can't bill for.
 */
export async function reserveCreditSlot(
  opts: ReserveOptions,
): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    throw new Error(
      "Supabase admin not configured — refusing to run a billable LLM call without metering",
    )
  }

  const profile = await getProfile(opts.userId)
  const limit = monthlyLimitForTier(profile.tier)

  const { data, error } = await supabase.rpc("reserve_credit_slot", {
    uid: opts.userId,
    kind: opts.kind,
    monthly_limit: limit,
    meta: opts.payload as Record<string, unknown>,
  })
  if (error) {
    throw new Error(
      `reserve_credit_slot failed: ${error.message}. Has migration 0014_credit_reservation.sql been applied?`,
    )
  }
  // The RPC returns NULL when the user is over budget. PostgREST surfaces
  // that as data === null. Anything else is a uuid string.
  return (data as string | null) ?? null
}

/**
 * Replace a reservation row's placeholder payload with the real result
 * after the LLM call succeeds. The `payload` keys must match the
 * column names of the table.
 */
export async function updateReservation(
  table: ReservationTable,
  reservationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return // best-effort — row exists but with placeholder data
  const { error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", reservationId)
  if (error) {
    console.error(
      `[quota] failed to update reservation ${reservationId} in ${table}:`,
      error.message,
    )
  }
}

/**
 * Delete a reservation when the LLM call fails — the user shouldn't be
 * charged for compute they didn't get. Best-effort: a failed delete
 * leaves the row in place with placeholder data, which still counts
 * against quota. That's preferable to losing track of it entirely.
 */
export async function releaseReservation(
  table: ReservationTable,
  reservationId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("id", reservationId)
  if (error) {
    console.error(
      `[quota] failed to release reservation ${reservationId} in ${table}:`,
      error.message,
    )
  }
}

/** Resolve a kind to its underlying table (helper for tests + routes). */
export { tableForKind }

// ---------- Public: post-action credit charge ----------

export interface ChargeResult {
  /** Which pool the credit was billed against. */
  source: "monthly" | "topup" | "overage"
  /** Topup row id, only set when source === "topup". */
  topupId: string | null
}

/**
 * Record that the user just consumed one credit. Called AFTER the
 * consumption row has been inserted into `gig_analyses` /
 * `gig_generations` (so the row counts toward the post-insert tally).
 *
 * The rule is "monthly pool first, then topups, oldest first":
 *   - If the user is still within their monthly allowance, this is a no-op
 *     (the new consumption row itself is the accounting).
 *   - If they've now exceeded the monthly cap, we atomically decrement
 *     the oldest available topup row via the `decrement_oldest_topup`
 *     Postgres RPC.
 *   - If no topup is available either, the user has effectively had a
 *     free overage credit — logged as a warning since the API should
 *     have 402'd before reaching this point. Returning "overage" lets
 *     callers surface it for monitoring without blowing up the response.
 *
 * Self-contained: re-reads the post-insert count itself. That's an
 * extra round trip per call, but it's cheap (indexed COUNT) and removes
 * the "did the caller pass the right pre/post count?" footgun.
 */
export async function chargeCredit(userId: string): Promise<ChargeResult> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return { source: "monthly", topupId: null }

  const [profile, postInsertUsed] = await Promise.all([
    getProfile(userId),
    countCreditsUsedThisMonth(userId),
  ])
  const limit = monthlyLimitForTier(profile.tier)
  if (postInsertUsed <= limit) {
    return { source: "monthly", topupId: null }
  }

  // Over the monthly cap — try to charge a topup. The RPC handles the
  // atomic "pick oldest non-empty row, decrement by 1" in a single
  // statement; concurrent decrements can't collide.
  const { data, error } = await supabase.rpc("decrement_oldest_topup", {
    uid: userId,
  })
  if (error) {
    console.error("[quota] decrement_oldest_topup failed:", error.message)
    return { source: "overage", topupId: null }
  }
  const topupId = (data as string | null) ?? null
  if (!topupId) {
    // Should be rare: the API gate already verified the user had room
    // before doing the work. Most likely cause is a concurrent request
    // that consumed the last topup credit between our gate read and the
    // decrement attempt. Surface as "overage" so monitoring can catch it.
    console.warn(
      `[quota] user ${userId} burned a credit but had no topup balance to charge it to`,
    )
    return { source: "overage", topupId: null }
  }
  return { source: "topup", topupId }
}

// ---------- Tracked-gig quota (unchanged) ----------

export interface TrackedGigQuota {
  used: number
  limit: number
  allowed: boolean
  isPremium: boolean
}

async function countTrackedGigs(userId: string): Promise<number> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return 0
  const { count, error } = await supabase
    .from("tracked_gigs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
  if (error) {
    console.error("[quota] tracked count failed:", error.message)
    return 0
  }
  return count ?? 0
}

/**
 * Current tracked-gig usage snapshot for a user.
 * Limits: 1 free, 7 pro, 15 agency. Override via env vars.
 */
export async function getTrackedGigQuota(
  userId: string,
): Promise<TrackedGigQuota> {
  const [profile, used] = await Promise.all([
    getProfile(userId),
    countTrackedGigs(userId),
  ])
  const limit = trackedGigLimitForTier(profile.tier)
  return {
    used,
    limit,
    allowed: used < limit,
    isPremium: profile.isPremium,
  }
}
