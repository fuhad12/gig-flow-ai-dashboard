import type { Tier } from "@/lib/stripe"

/** Row shape for the read-only admin users table. */
export interface AdminUserRow {
  id: string
  email: string
  createdAt: string
  tier: Tier
  subscriptionStatus: string | null
  subscriptionPlan: string | null
  currentPeriodEnd: string | null
  onboardedAt: string | null
  creditsUsed: number
  creditLimit: number
  topupBalance: number
}
