import { NextResponse } from "next/server"

import { confirmFlutterwaveReturn } from "@/lib/billing-activate"
import { createSupabaseServer } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Verify a Flutterwave payment after redirect and activate Pro / top-up.
 * Body or query: transaction_id / transactionId, tx_ref / txRef.
 */
export async function POST(req: Request) {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Auth is not configured" },
      { status: 500 },
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const url = new URL(req.url)
  const transactionId =
    (typeof body.transactionId === "string" && body.transactionId) ||
    (typeof body.transaction_id === "string" && body.transaction_id) ||
    url.searchParams.get("transaction_id") ||
    url.searchParams.get("transactionId")
  const txRef =
    (typeof body.txRef === "string" && body.txRef) ||
    (typeof body.tx_ref === "string" && body.tx_ref) ||
    url.searchParams.get("tx_ref") ||
    url.searchParams.get("txRef")

  if (!transactionId && !txRef) {
    return NextResponse.json(
      { error: "transaction_id or tx_ref required" },
      { status: 400 },
    )
  }

  try {
    const result = await confirmFlutterwaveReturn({
      transactionId,
      txRef,
      expectedUserId: user.id,
    })
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.reason ?? "confirm_failed" },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: true, kind: result.kind })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to confirm payment"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
