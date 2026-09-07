import { redirect } from "next/navigation"

import { Dashboard } from "@/components/dashboard"
import { MarketingLanding } from "@/components/marketing-landing"
import { SetupRequired } from "@/components/setup-required"
import { createSupabaseServer } from "@/lib/supabase/server"
import { getQuotaStatus } from "@/lib/quota"

export const dynamic = "force-dynamic"

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
    />
  )
}
