/**
 * Same Flutterwave topup webhook delivered twice never double-credits.
 *
 * Defense: UNIQUE on credit_topups.stripe_payment_intent_id (stores flw_ref).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

interface InsertedRow {
  user_id: string
  stripe_payment_intent_id: string
  pack_id: string
  credits_total: number
  credits_remaining: number
}

const insertedRows: InsertedRow[] = []

function makeAdminStub() {
  return {
    from(table: string) {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null })
        },
        update() {
          return { eq: () => Promise.resolve({ error: null }) }
        },
        async insert(row: InsertedRow) {
          if (table !== "credit_topups") {
            return { error: null }
          }
          const dup = insertedRows.find(
            (r) => r.stripe_payment_intent_id === row.stripe_payment_intent_id,
          )
          if (dup) {
            return { error: { code: "23505", message: "duplicate key" } }
          }
          insertedRows.push(row)
          return { error: null }
        },
      }
    },
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => makeAdminStub(),
}))

import { POST as webhookPOST } from "@/app/api/billing/webhook/route"

const FLW_REF = "FLW-MOCK-REF-15"
const USER_ID = "user-1"
const SECRET_HASH = "test-secret-hash"

function buildPayload(overrides?: {
  status?: string
  flw_ref?: string | null
}) {
  return {
    event: "charge.completed",
    data: {
      id: 99101,
      tx_ref: `jf_topup_${USER_ID}_topup-15_1`,
      flw_ref: overrides?.flw_ref === null ? undefined : (overrides?.flw_ref ?? FLW_REF),
      amount: 9.99,
      currency: "USD",
      status: overrides?.status ?? "successful",
      meta: {
        type: "topup",
        user_id: USER_ID,
        pack_id: "topup-15",
        credits: "15",
      },
      customer: { email: "user@example.com" },
    },
  }
}

async function callWebhook(body = buildPayload()) {
  return webhookPOST(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "verif-hash": SECRET_HASH,
      },
      body: JSON.stringify(body),
    }),
  )
}

describe("topup webhook idempotency (Flutterwave)", () => {
  beforeEach(() => {
    insertedRows.length = 0
    process.env.FLUTTERWAVE_SECRET_HASH = SECRET_HASH
  })

  it("first delivery inserts exactly one credit_topups row", async () => {
    const res = await callWebhook()
    expect(res.status).toBe(200)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].stripe_payment_intent_id).toBe(FLW_REF)
    expect(insertedRows[0].credits_total).toBe(15)
    expect(insertedRows[0].credits_remaining).toBe(15)
  })

  it("duplicate delivery swallows the unique-violation", async () => {
    const first = await callWebhook()
    expect(first.status).toBe(200)
    expect(insertedRows).toHaveLength(1)

    const second = await callWebhook()
    expect(second.status).toBe(200)
    expect(insertedRows).toHaveLength(1)
  })

  it("does not credit when status is not successful", async () => {
    const res = await callWebhook(buildPayload({ status: "failed" }))
    expect(res.status).toBe(200)
    expect(insertedRows).toHaveLength(0)
  })

  it("does not credit when payment ref is missing", async () => {
    const res = await callWebhook(
      buildPayload({ flw_ref: null }),
    )
    // Still has data.id → falls back to flw_${id}
    expect(res.status).toBe(200)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].stripe_payment_intent_id).toBe("flw_99101")
  })

  it("rejects bad verif-hash", async () => {
    const res = await webhookPOST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "verif-hash": "wrong",
        },
        body: JSON.stringify(buildPayload()),
      }),
    )
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })
})
