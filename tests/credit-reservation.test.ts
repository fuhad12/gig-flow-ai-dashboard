/**
 * Unit tests for the atomic credit-reservation helpers in lib/quota.ts.
 *
 * The reservation pattern is the fix for "users can generate more than 2
 * gigs without paying": instead of {check quota → run LLM → insert row},
 * the routes now {insert row atomically under a per-user advisory lock →
 * run LLM → UPDATE row}. That closes the TOCTOU race and makes silent
 * metering failures impossible.
 *
 * We stub the Supabase admin client so the tests don't need a live DB,
 * and exercise:
 *
 *   - reserveCreditSlot returns the rpc uuid when there's budget
 *   - reserveCreditSlot returns null when the RPC says "over budget"
 *   - reserveCreditSlot throws when admin isn't configured (so the
 *     route returns 500 instead of giving a free LLM result)
 *   - reserveCreditSlot throws on RPC errors (migration not applied)
 *   - reserveCreditSlot passes the correct args to the RPC
 *   - updateReservation hits the right table + row + columns
 *   - releaseReservation deletes the right row
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------- Stub state ----------

interface RpcCall {
  fn: string
  args: Record<string, unknown>
}

interface UpdateCall {
  table: string
  payload: Record<string, unknown>
  eqId: string
}

interface DeleteCall {
  table: string
  eqId: string
}

interface Stub {
  // Whether the admin client should be returned (null when not configured).
  adminAvailable: boolean
  // Profile read by getProfile() — drives monthlyLimitForTier in the RPC args.
  profile: {
    subscription_status: string | null
    subscription_tier: string | null
    subscription_plan: string | null
    current_period_end: string | null
    selected_niches: string[] | null
    skill_tags: string[] | null
    onboarded_at: string | null
  }
  // Next rpc() return value.
  rpcResult: { data: string | null; error: { message: string } | null }
  rpcCalls: RpcCall[]
  // Next update().eq() return value.
  updateResult: { error: { message: string } | null }
  updateCalls: UpdateCall[]
  // Next delete().eq() return value.
  deleteResult: { error: { message: string } | null }
  deleteCalls: DeleteCall[]
}

const stub: Stub = {
  adminAvailable: true,
  profile: {
    subscription_status: null,
    subscription_tier: null,
    subscription_plan: null,
    current_period_end: null,
    selected_niches: null,
    skill_tags: null,
    onboarded_at: null,
  },
  rpcResult: { data: null, error: null },
  rpcCalls: [],
  updateResult: { error: null },
  updateCalls: [],
  deleteResult: { error: null },
  deleteCalls: [],
}

function resetStub(overrides: Partial<Stub> = {}) {
  stub.adminAvailable = overrides.adminAvailable ?? true
  stub.profile = overrides.profile ?? {
    subscription_status: null,
    subscription_tier: null,
    subscription_plan: null,
    current_period_end: null,
    selected_niches: null,
    skill_tags: null,
    onboarded_at: null,
  }
  stub.rpcResult = overrides.rpcResult ?? { data: null, error: null }
  stub.rpcCalls = []
  stub.updateResult = overrides.updateResult ?? { error: null }
  stub.updateCalls = []
  stub.deleteResult = overrides.deleteResult ?? { error: null }
  stub.deleteCalls = []
}

function makeAdminStub() {
  return {
    from(table: string) {
      return {
        // getProfile() path: select(...).eq(...).maybeSingle()
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                async maybeSingle() {
                  if (table === "profiles") {
                    return { data: stub.profile, error: null }
                  }
                  return { data: null, error: null }
                },
              }
            },
          }
        },
        // updateReservation path: update(payload).eq("id", id)
        update(payload: Record<string, unknown>) {
          return {
            async eq(_col: string, val: unknown) {
              stub.updateCalls.push({
                table,
                payload,
                eqId: String(val),
              })
              return stub.updateResult
            },
          }
        },
        // releaseReservation path: delete().eq("id", id)
        delete() {
          return {
            async eq(_col: string, val: unknown) {
              stub.deleteCalls.push({ table, eqId: String(val) })
              return stub.deleteResult
            },
          }
        },
      }
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      stub.rpcCalls.push({ fn, args })
      return stub.rpcResult
    },
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => (stub.adminAvailable ? makeAdminStub() : null),
}))

// Imports must come AFTER the vi.mock declaration above.
import {
  FREE_MONTHLY_SCAN_LIMIT,
  PRO_MONTHLY_SCAN_LIMIT,
  releaseReservation,
  reserveCreditSlot,
  updateReservation,
} from "@/lib/quota"

// ---------- Tests ----------

beforeEach(() => {
  resetStub()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("reserveCreditSlot", () => {
  it("returns the reservation uuid when the RPC reports budget remaining", async () => {
    resetStub({ rpcResult: { data: "reservation-123", error: null } })
    const id = await reserveCreditSlot({
      userId: "user-1",
      kind: "generation",
      payload: { niche: "logo-design" },
    })
    expect(id).toBe("reservation-123")
    expect(stub.rpcCalls).toHaveLength(1)
    const call = stub.rpcCalls[0]
    expect(call.fn).toBe("reserve_credit_slot")
    expect(call.args).toMatchObject({
      uid: "user-1",
      kind: "generation",
      monthly_limit: FREE_MONTHLY_SCAN_LIMIT,
      meta: { niche: "logo-design" },
    })
  })

  it("passes the Pro tier limit when the user has an active subscription", async () => {
    resetStub({
      profile: {
        ...stub.profile,
        subscription_status: "active",
        subscription_tier: "pro",
      },
      rpcResult: { data: "reservation-xyz", error: null },
    })
    await reserveCreditSlot({
      userId: "user-1",
      kind: "analysis",
      payload: { url: "https://fiverr.com/x" },
    })
    expect(stub.rpcCalls[0].args).toMatchObject({
      monthly_limit: PRO_MONTHLY_SCAN_LIMIT,
      kind: "analysis",
    })
  })

  it("returns null when the RPC says the user is over budget", async () => {
    // The RPC's contract: returns NULL when used >= monthly + topup.
    // PostgREST surfaces that as data === null.
    resetStub({ rpcResult: { data: null, error: null } })
    const id = await reserveCreditSlot({
      userId: "user-broke",
      kind: "generation",
      payload: { niche: "logo-design" },
    })
    expect(id).toBeNull()
  })

  it("throws when the admin client isn't configured — protects against silent metering failure", async () => {
    resetStub({ adminAvailable: false })
    await expect(() =>
      reserveCreditSlot({
        userId: "user-1",
        kind: "generation",
        payload: { niche: "logo-design" },
      }),
    ).rejects.toThrow(/Supabase admin not configured/)
  })

  it("throws a helpful error when the RPC isn't deployed (migration not applied)", async () => {
    resetStub({
      rpcResult: {
        data: null,
        error: { message: 'function reserve_credit_slot does not exist' },
      },
    })
    await expect(() =>
      reserveCreditSlot({
        userId: "user-1",
        kind: "generation",
        payload: { niche: "logo-design" },
      }),
    ).rejects.toThrow(/0014_credit_reservation\.sql/)
  })
})

describe("updateReservation", () => {
  it("updates the reservation row's columns to the real LLM output", async () => {
    resetStub()
    await updateReservation("gig_generations", "row-1", {
      generation: { gigTitle: "I will design a logo" },
    })
    expect(stub.updateCalls).toEqual([
      {
        table: "gig_generations",
        payload: { generation: { gigTitle: "I will design a logo" } },
        eqId: "row-1",
      },
    ])
  })

  it("no-ops when the admin client isn't configured (logs but doesn't throw)", async () => {
    resetStub({ adminAvailable: false })
    await expect(
      updateReservation("gig_analyses", "row-2", { analysis: {} }),
    ).resolves.toBeUndefined()
    expect(stub.updateCalls).toHaveLength(0)
  })
})

describe("releaseReservation", () => {
  it("deletes the reservation row when the LLM call fails", async () => {
    resetStub()
    await releaseReservation("gig_generations", "row-1")
    expect(stub.deleteCalls).toEqual([
      { table: "gig_generations", eqId: "row-1" },
    ])
  })

  it("targets the analyses table for analysis reservations", async () => {
    resetStub()
    await releaseReservation("gig_analyses", "row-2")
    expect(stub.deleteCalls).toEqual([
      { table: "gig_analyses", eqId: "row-2" },
    ])
  })

  it("no-ops gracefully when admin isn't configured", async () => {
    resetStub({ adminAvailable: false })
    await expect(
      releaseReservation("gig_generations", "row-1"),
    ).resolves.toBeUndefined()
    expect(stub.deleteCalls).toHaveLength(0)
  })
})
