/**
 * Unit tests for the tier + topup billing surface.
 *
 * The goal of these tests is to lock down the "users get exactly what
 * they paid for" guarantees:
 *
 *   - `planForPrice` round-trips Flutterwave payment plan ids
 *   - `monthlyLimitForTier` returns the right cap per tier
 *   - `chargeCredit` charges monthly first, then atomically pulls
 *     from a topup row when monthly is exhausted — and surfaces
 *     "overage" cleanly when both pools are empty
 *
 * We stub the Supabase admin client so the tests don't need a live DB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------- Test-scope mutable env ----------

const ORIGINAL_ENV = { ...process.env }

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

// ---------- Supabase admin stub ----------
//
// We use a builder pattern that mirrors supabase-js so the production
// callers compile against the same surface. Each test resets the stub
// state via `setStub(...)`.

interface Stub {
  // Returned by `from(table).select(...).eq(...).maybeSingle()` for `profiles`.
  profile?: { subscription_status: string | null; subscription_tier: string | null }
  // Returned by COUNT queries (analyses + generations).
  analysisCount: number
  generationCount: number
  // Returned by `rpc("decrement_oldest_topup", ...)`.
  rpcResult: { data: string | null; error: { message: string } | null }
  // Records each rpc call so tests can assert on it.
  rpcCalls: Array<{ fn: string; args: unknown }>
}

const stub: Stub = {
  profile: undefined,
  analysisCount: 0,
  generationCount: 0,
  rpcResult: { data: null, error: null },
  rpcCalls: [],
}

function resetStub(overrides: Partial<Stub> = {}) {
  stub.profile = overrides.profile ?? {
    subscription_status: "active",
    subscription_tier: "pro",
  }
  stub.analysisCount = overrides.analysisCount ?? 0
  stub.generationCount = overrides.generationCount ?? 0
  stub.rpcResult = overrides.rpcResult ?? { data: null, error: null }
  stub.rpcCalls = []
}

function makeAdminStub() {
  return {
    from(table: string) {
      const builder = {
        _filters: {} as Record<string, unknown>,
        _isCount: false,
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.count === "exact") builder._isCount = true
          return builder
        },
        eq(_col: string, _val: unknown) {
          return builder
        },
        gte(_col: string, _val: unknown) {
          return builder
        },
        gt(_col: string, _val: unknown) {
          return builder
        },
        async maybeSingle() {
          if (table === "profiles") return { data: stub.profile, error: null }
          return { data: null, error: null }
        },
        // Awaiting the builder triggers the actual query for COUNT calls.
        then(resolve: (v: unknown) => void) {
          if (builder._isCount) {
            const count =
              table === "gig_analyses"
                ? stub.analysisCount
                : table === "gig_generations"
                  ? stub.generationCount
                  : 0
            resolve({ count, error: null })
            return
          }
          // For credit_topups balance read.
          if (table === "credit_topups") {
            resolve({ data: [], error: null })
            return
          }
          resolve({ data: null, error: null })
        },
      }
      return builder
    },
    async rpc(fn: string, args: unknown) {
      stub.rpcCalls.push({ fn, args })
      return stub.rpcResult
    },
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => makeAdminStub(),
}))

// Import AFTER the mock declarations so the module sees the stubs.
import {
  chargeCredit,
  monthlyLimitForTier,
  monthlyTrendLimitForTier,
  FREE_MONTHLY_SCAN_LIMIT,
  PRO_MONTHLY_SCAN_LIMIT,
  AGENCY_MONTHLY_SCAN_LIMIT,
  FREE_MONTHLY_TREND_LIMIT,
  PRO_MONTHLY_TREND_LIMIT,
  AGENCY_MONTHLY_TREND_LIMIT,
} from "@/lib/quota"
import { planForPrice, tierOf } from "@/lib/stripe"

// ---------- planForPrice ----------

describe("planForPrice", () => {
  beforeEach(() => {
    setEnv({
      FLUTTERWAVE_PLAN_PRO_MONTHLY: "242933",
      FLUTTERWAVE_PLAN_PRO_YEARLY: "242942",
      FLUTTERWAVE_PLAN_AGENCY_MONTHLY: "242940",
      FLUTTERWAVE_PLAN_AGENCY_YEARLY: "242941",
    })
  })
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("resolves Flutterwave payment plan ids", () => {
    expect(planForPrice("242933")).toBe("pro-monthly")
    expect(planForPrice(242941)).toBe("agency-yearly")
  })

  it("returns null for unknown or missing plan ids", () => {
    expect(planForPrice("999999")).toBeNull()
    expect(planForPrice(null)).toBeNull()
    expect(planForPrice(undefined)).toBeNull()
  })

  it("maps every plan to its tier consistently", () => {
    expect(tierOf("pro-monthly")).toBe("pro")
    expect(tierOf("pro-yearly")).toBe("pro")
    expect(tierOf("agency-monthly")).toBe("agency")
    expect(tierOf("agency-yearly")).toBe("agency")
  })
})

// ---------- monthlyLimitForTier ----------

describe("monthlyLimitForTier", () => {
  it("returns the configured per-tier limit", () => {
    expect(monthlyLimitForTier("free")).toBe(FREE_MONTHLY_SCAN_LIMIT)
    expect(monthlyLimitForTier("pro")).toBe(PRO_MONTHLY_SCAN_LIMIT)
    expect(monthlyLimitForTier("agency")).toBe(AGENCY_MONTHLY_SCAN_LIMIT)
  })

  it("uses sane defaults of 5 / 20 / 50", () => {
    expect(FREE_MONTHLY_SCAN_LIMIT).toBe(5)
    expect(PRO_MONTHLY_SCAN_LIMIT).toBe(20)
    expect(AGENCY_MONTHLY_SCAN_LIMIT).toBe(50)
  })
})

describe("monthlyTrendLimitForTier", () => {
  it("returns Free 2 / Pro 7 / Agency 15", () => {
    expect(monthlyTrendLimitForTier("free")).toBe(FREE_MONTHLY_TREND_LIMIT)
    expect(monthlyTrendLimitForTier("pro")).toBe(PRO_MONTHLY_TREND_LIMIT)
    expect(monthlyTrendLimitForTier("agency")).toBe(AGENCY_MONTHLY_TREND_LIMIT)
    expect(FREE_MONTHLY_TREND_LIMIT).toBe(2)
    expect(PRO_MONTHLY_TREND_LIMIT).toBe(7)
    expect(AGENCY_MONTHLY_TREND_LIMIT).toBe(15)
  })
})

// ---------- chargeCredit ----------

describe("chargeCredit", () => {
  beforeEach(() => {
    resetStub()
  })

  it("returns source: 'monthly' when the user is still under their cap", async () => {
    resetStub({
      profile: { subscription_status: "active", subscription_tier: "pro" },
      // Post-insert: 15 used, limit is 20 → still monthly.
      analysisCount: 10,
      generationCount: 5,
    })
    const result = await chargeCredit("u1")
    expect(result.source).toBe("monthly")
    expect(result.topupId).toBeNull()
    // No RPC call when monthly covers it.
    expect(stub.rpcCalls).toHaveLength(0)
  })

  it("calls the atomic decrement RPC when monthly is exhausted", async () => {
    resetStub({
      profile: { subscription_status: "active", subscription_tier: "pro" },
      // Post-insert: 21 used, limit is 20 → spilled into topups.
      analysisCount: 15,
      generationCount: 6,
      rpcResult: { data: "topup-abc", error: null },
    })
    const result = await chargeCredit("u1")
    expect(result.source).toBe("topup")
    expect(result.topupId).toBe("topup-abc")
    expect(stub.rpcCalls).toEqual([
      { fn: "decrement_oldest_topup", args: { uid: "u1" } },
    ])
  })

  it("returns source: 'overage' when monthly is exhausted AND no topup is available", async () => {
    resetStub({
      profile: { subscription_status: "active", subscription_tier: "pro" },
      analysisCount: 20,
      generationCount: 1,
      // RPC returns null → no row had credits remaining.
      rpcResult: { data: null, error: null },
    })
    const result = await chargeCredit("u1")
    expect(result.source).toBe("overage")
    expect(result.topupId).toBeNull()
  })

  it("treats canceled subscriptions as free tier when deciding charge source", async () => {
    resetStub({
      // Canceled subscription → resolveTier returns "free", limit = 5.
      profile: { subscription_status: "canceled", subscription_tier: "pro" },
      analysisCount: 5,
      generationCount: 0,
      rpcResult: { data: "topup-xyz", error: null },
    })
    const result = await chargeCredit("u1")
    expect(result.source).toBe("topup")
    expect(result.topupId).toBe("topup-xyz")
  })

  it("uses agency limit (100) when subscription_tier is 'agency'", async () => {
    resetStub({
      profile: { subscription_status: "active", subscription_tier: "agency" },
      // 50 used, limit is 100 → comfortably monthly.
      analysisCount: 30,
      generationCount: 20,
    })
    const result = await chargeCredit("u1")
    expect(result.source).toBe("monthly")
    expect(stub.rpcCalls).toHaveLength(0)
  })
})
