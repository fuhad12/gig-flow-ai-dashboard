import { NextResponse } from "next/server"

import { createSupabaseServer } from "@/lib/supabase/server"
import { cancelFlutterwaveSubscriptionsForEmail } from "@/lib/stripe"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"

/**
 * Flutterwave has no Stripe-style customer portal.
 * This endpoint cancels active subscriptions for the signed-in email
 * and marks the profile as canceled. Client may reload without a redirect URL.
 */
export async function POST() {
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
  if (!user?.email) {
    return NextResponse.json(
      { error: "You must be signed in" },
      { status: 401 },
    )
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: "Server is misconfigured" },
      { status: 500 },
    )
  }

  try {
    await cancelFlutterwaveSubscriptionsForEmail(user.email)

    const { error } = await admin
      .from("profiles")
      .update({
        subscription_status: "canceled",
        subscription_tier: "free",
      })
      .eq("id", user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(
      {
        canceled: true,
        message:
          "Subscription canceled. You keep access until the current period ends if Flutterwave already billed this cycle.",
      },
      { status: 200 },
    )
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to cancel subscription"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
