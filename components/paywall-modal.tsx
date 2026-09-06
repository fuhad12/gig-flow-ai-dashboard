"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertCircle,
  Check,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react"

import { TOPUP_PACKS } from "@/lib/stripe-packs"
import {
  AGENCY_MONTHLY_SCAN_LIMIT,
  AGENCY_TRACKED_GIG_LIMIT,
  PRO_MONTHLY_SCAN_LIMIT,
  PRO_TRACKED_GIG_LIMIT,
} from "@/lib/quota"

interface PaywallModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * If true, the modal opens straight on the "Buy credits" tab. Use this
   * when the user just hit their cap and needs to keep working — a tier
   * upgrade is the wrong CTA at that moment.
   */
  defaultMode?: "tiers" | "topups"
}

type Cadence = "monthly" | "yearly"
type Tier = "pro" | "agency"

interface TierDef {
  id: Tier
  name: string
  credits: number
  description: string
  monthlyPrice: number
  yearlyPrice: number
  yearlyMonthlyEquivalent: number
  highlight?: boolean
  features: string[]
}

// Yearly prices are set to ~25% off the monthly equivalent (effectively
// "3 months free per year"). The displayed monthly equivalent rounds to
// the nearest dollar for clean UI: Pro $9/mo, Agency $22/mo.
const TIERS: TierDef[] = [
  {
    id: "pro",
    name: "Pro",
    credits: PRO_MONTHLY_SCAN_LIMIT,
    description: "For solo sellers shipping a few audits a week.",
    monthlyPrice: 12,
    yearlyPrice: 108,
    yearlyMonthlyEquivalent: 9,
    highlight: true,
    features: [
      `${PRO_MONTHLY_SCAN_LIMIT} AI credits / month`,
      "Audits, Upwork proposals & predictions",
      "Trend & keyword intelligence",
      `Up to ${PRO_TRACKED_GIG_LIMIT} tracked competitor gigs`,
    ],
  },
  {
    id: "agency",
    name: "Agency",
    credits: AGENCY_MONTHLY_SCAN_LIMIT,
    description: "For agencies and power sellers running many gigs.",
    monthlyPrice: 29.99,
    yearlyPrice: 269.99,
    yearlyMonthlyEquivalent: 22.5,
    features: [
      `${AGENCY_MONTHLY_SCAN_LIMIT} AI credits / month`,
      "Everything in Pro",
      `Up to ${AGENCY_TRACKED_GIG_LIMIT} tracked competitor gigs`,
      "Side-by-side comparisons",
      "Priority AI processing",
    ],
  },
]

export function PaywallModal({
  open,
  onOpenChange,
  defaultMode = "tiers",
}: PaywallModalProps) {
  const [mode, setMode] = useState<"tiers" | "topups">(defaultMode)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-2xl">
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-violet-500/10">
            <Sparkles className="size-6 text-violet-400" />
          </div>
          <DialogTitle className="text-xl font-bold text-foreground">
            Get more AI credits
          </DialogTitle>
          <DialogDescription className="mt-1 text-muted-foreground">
            Upgrade your plan, or grab a one-time credit pack to keep going
            this month.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as typeof mode)}
          className="mt-3"
        >
          <TabsList className="grid w-full grid-cols-2 bg-secondary">
            <TabsTrigger
              value="tiers"
              className="data-[state=active]:bg-card data-[state=active]:text-violet-400"
            >
              Upgrade plan
            </TabsTrigger>
            <TabsTrigger
              value="topups"
              className="data-[state=active]:bg-card data-[state=active]:text-violet-400"
            >
              Buy credits
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "tiers" ? <TiersPanel /> : <TopupsPanel />}
      </DialogContent>
    </Dialog>
  )
}

// ---------- Tiers panel ----------

function TiersPanel() {
  const [cadence, setCadence] = useState<Cadence>("monthly")
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleUpgrade = async (tier: Tier) => {
    const planId = `${tier}-${cadence}` as const
    setError(null)
    setLoadingPlan(planId)
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      const { url } = (await res.json()) as { url: string }
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setLoadingPlan(null)
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-4 flex justify-center">
        <Tabs value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
          <TabsList className="bg-secondary">
            <TabsTrigger
              value="monthly"
              className="data-[state=active]:bg-card data-[state=active]:text-violet-400"
            >
              Monthly
            </TabsTrigger>
            <TabsTrigger
              value="yearly"
              className="data-[state=active]:bg-card data-[state=active]:text-violet-400"
            >
              Yearly · save 25%
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {TIERS.map((tier) => {
          const price =
            cadence === "monthly"
              ? tier.monthlyPrice
              : tier.yearlyMonthlyEquivalent
          const billed =
            cadence === "monthly"
              ? "billed monthly"
              : `billed $${tier.yearlyPrice}/yr`
          const planId = `${tier.id}-${cadence}`
          const loading = loadingPlan === planId
          return (
            <div
              key={tier.id}
              className={`relative rounded-xl border p-4 ${
                tier.highlight
                  ? "border-violet-500/40 bg-violet-500/5"
                  : "border-border bg-secondary/40"
              }`}
            >
              {tier.highlight && (
                <Badge className="absolute -top-2 right-4 border-violet-500/30 bg-violet-500/20 text-[10px] font-semibold text-violet-300">
                  Most popular
                </Badge>
              )}
              <div className="mb-1 text-sm font-semibold uppercase tracking-wider text-violet-300">
                {tier.name}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-foreground">
                  ${price.toFixed(price % 1 === 0 ? 0 : 2)}
                </span>
                <span className="text-xs text-muted-foreground">/month</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{billed}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {tier.description}
              </p>
              <ul className="mt-3 space-y-1.5">
                {tier.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-xs text-foreground"
                  >
                    <Check className="mt-0.5 size-3.5 shrink-0 text-emerald" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => handleUpgrade(tier.id)}
                disabled={loading}
                className={`mt-4 w-full ${
                  tier.highlight
                    ? "bg-violet-600 text-white hover:bg-violet-700"
                    : ""
                }`}
                variant={tier.highlight ? "default" : "outline"}
              >
                {loading && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                {loading ? "Redirecting..." : `Choose ${tier.name}`}
              </Button>
            </div>
          )
        })}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

// ---------- Topups panel ----------

function TopupsPanel() {
  const [loadingPack, setLoadingPack] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleBuy = async (packId: string) => {
    setError(null)
    setLoadingPack(packId)
    try {
      const res = await fetch("/api/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      const { url } = (await res.json()) as { url: string }
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setLoadingPack(null)
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">One-time purchase.</strong> Top-up
        credits roll forward across months and never expire — you get exactly
        what you pay for, even after you cancel.
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {TOPUP_PACKS.map((pack) => {
          const pricePerCredit = (pack.amountCents / 100 / pack.credits).toFixed(
            2,
          )
          const loading = loadingPack === pack.id
          return (
            <div
              key={pack.id}
              className="flex flex-col rounded-lg border border-border bg-secondary/40 p-3"
            >
              <div className="flex items-center gap-2 text-emerald">
                <Zap className="size-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {pack.label}
                </span>
              </div>
              <div className="mt-1 text-2xl font-bold text-foreground">
                ${(pack.amountCents / 100).toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                ${pricePerCredit} / credit
              </div>
              <Button
                onClick={() => handleBuy(pack.id)}
                disabled={loading}
                variant="outline"
                size="sm"
                className="mt-3"
              >
                {loading && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                {loading ? "..." : "Buy"}
              </Button>
            </div>
          )
        })}
      </div>
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
