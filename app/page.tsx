import { redirect } from "next/navigation"

import { Dashboard } from "@/components/dashboard"
import { MarketingLanding } from "@/components/marketing-landing"
import { SetupRequired } from "@/components/setup-required"
import { confirmFlutterwaveReturn } from "@/lib/billing-activate"
import { createSupabaseServer } from "@/lib/supabase/server"
import { getQuotaStatus } from "@/lib/quota"
import { isAdminEmail } from "@/lib/admin"
import { isInfluencerEmail } from "@/lib/referral"

export const dynamic = "force-dynamic"

function paramString(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  // Auth emails sometimes land on Site URL (`/?code=...`) instead of
  // `/auth/callback`. Forward so signup / reset still complete.
  const code = typeof params.code === "string" ? params.code : null
  if (code) {
    const nextRaw = typeof params.next === "string" ? params.next : "/"
    const next =
      nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/"
    redirect(
      `/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`,
    )
  }

  const supabase = await createSupabaseServer()
  if (!supabase) {
    return <SetupRequired />
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Unauthenticated visitors get the marketing site. Sign-in CTAs there
  // route to /auth which redirects back to `/` on success, lifting them
  // straight into the dashboard.
  if (!user) {
    return <MarketingLanding />
  }

  // Flutterwave redirects here after checkout. Verify + activate Pro/top-up
  // even if the webhook was delayed or misconfigured, then clean the URL.
  const subscribed = paramString(params.subscribed)
  const topup = paramString(params.topup)
  const payStatus = paramString(params.status)?.toLowerCase()
  const transactionId = paramString(params.transaction_id)
  const txRef = paramString(params.tx_ref)
  const paymentReturn =
    subscribed === "success" ||
    topup === "success" ||
    payStatus === "successful" ||
    payStatus === "success"

  if (paymentReturn && (transactionId || txRef)) {
    let result: { ok: boolean; reason?: string }
    try {
      result = await confirmFlutterwaveReturn({
        transactionId,
        txRef,
        expectedUserId: user.id,
      })
    } catch (err) {
      console.error("[billing] confirm on return failed:", err)
      redirect("/?billing=failed&reason=exception")
    }
    if (result.ok) {
      redirect("/?billing=updated")
    }
    console.error("[billing] confirm returned not ok:", result.reason)
    redirect(
      `/?billing=failed&reason=${encodeURIComponent(result.reason ?? "confirm_failed")}`,
    )
  }

  const quota = await getQuotaStatus(user.id)

  // First-run onboarding gate.
  //
  // A user "needs onboarding" when they've never saved or dismissed the
  // niche-selection step. We detect that with `onboardedAt === null`,
  // not "selectedNiches is empty" — that way a user who intentionally
  // clears their niches later doesn't get force-routed back to Settings.
  // The dashboard uses this flag to default the initial view to Settings
  // and show a welcome banner above the niches card.
  const needsNicheOnboarding =
    quota.onboardedAt === null && quota.selectedNiches.length === 0

  const isInfluencer = await isInfluencerEmail(user.email)

  return (
    <Dashboard
      user={{ id: user.id, email: user.email ?? "" }}
      isPremium={quota.isPremium}
      tier={quota.tier}
      subscriptionPlan={quota.subscriptionPlan}
      subscriptionStatus={quota.subscriptionStatus}
      currentPeriodEnd={quota.currentPeriodEnd}
      initialCreditsUsed={quota.used}
      creditLimit={quota.limit}
      initialTopupBalance={quota.topupBalance}
      selectedNiches={quota.selectedNiches}
      skillTags={quota.skillTags}
      needsNicheOnboarding={needsNicheOnboarding}
      isAdmin={isAdminEmail(user.email)}
      isInfluencer={isInfluencer}
    />
  )
}
