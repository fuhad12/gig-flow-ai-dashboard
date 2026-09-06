import { redirect } from "next/navigation"

import { InfluencerDashboardView } from "@/components/influencer-dashboard-view"
import { normalizeInfluencerEmail } from "@/lib/referral"
import { createSupabaseServer } from "@/lib/supabase/server"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export default async function InfluencerPage() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    redirect("/")
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect("/auth?next=/influencer")
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    redirect("/")
  }

  const email = normalizeInfluencerEmail(user.email)
  const { data: influencer } = await admin
    .from("influencers")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle()

  if (
    !influencer ||
    normalizeInfluencerEmail(influencer.email as string) !== email
  ) {
    redirect("/")
  }

  return (
    <main className="min-h-screen bg-background">
      <InfluencerDashboardView />
    </main>
  )
}
