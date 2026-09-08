"use client"

/**
 * Influencer partner dashboard — referral link, referred users, commissions.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Megaphone,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { InfluencerLeaderboard } from "@/components/influencer-leaderboard"

interface MeResponse {
  influencer?: {
    id: string
    code: string
    name: string
    email: string
    commissionPct: number
    active: boolean
    referralUrl: string
  }
  stats?: {
    referredSignups: number
    proConversions: number
    pendingCents: number
    paidCents: number
  }
  referredUsers?: Array<{
    id: string
    email: string
    createdAt: string
    tier: string
    billing: "free" | "paid"
    subscriptionStatus: string | null
    subscriptionPlan: string | null
  }>
  commissions?: Array<{
    id: string
    userId: string
    stripeInvoiceId: string
    amountCents: number
    invoiceAmountCents: number
    currency: string
    status: string
    createdAt: string
  }>
  error?: string
}

function formatMoney(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(2)}`
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return "—"
  }
}

export function InfluencerDashboardView() {
  const [data, setData] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/influencer/me")
      const json = (await res.json()) as MeResponse
      if (res.status === 403) {
        setError("No influencer account is linked to this email.")
        setData(null)
        return
      }
      if (!res.ok) throw new Error(json.error || "Failed to load")
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copyLink = async () => {
    const url = data?.influencer?.referralUrl
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-emerald" />
        Loading partner dashboard…
      </div>
    )
  }

  if (error || !data?.influencer) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
        <div className="flex items-start justify-center gap-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error || "Not an influencer account"}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Back to app</Link>
        </Button>
      </div>
    )
  }

  const { influencer, stats, referredUsers = [], commissions = [] } = data

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground sm:text-2xl">
            <Megaphone className="size-5 text-emerald" />
            Partner dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Hi {influencer.name} · {influencer.commissionPct}% of Pro invoices
            {!influencer.active && " · inactive"}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to app</Link>
        </Button>
      </div>

      <Card className="border-emerald/30 bg-emerald/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your referral link</CardTitle>
          <CardDescription>
            Share this URL. Visitors are tracked automatically — no code to type.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="max-w-full flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-sm">
            {influencer.referralUrl}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => void copyLink()}
          >
            {copied ? (
              <>
                <Check className="size-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Referred signups" value={String(stats?.referredSignups ?? 0)} />
        <StatCard
          label="Pro conversions"
          value={String(stats?.proConversions ?? 0)}
        />
        <StatCard
          label="Pending"
          value={formatMoney(stats?.pendingCents ?? 0)}
        />
        <StatCard label="Paid out" value={formatMoney(stats?.paidCents ?? 0)} />
      </div>

      <InfluencerLeaderboard />

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Referred users</CardTitle>
          <CardDescription>
            People who signed up through your link · free vs paid
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Signed up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referredUsers.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-20 text-center text-sm text-muted-foreground"
                    >
                      No referrals yet — share your link to get started
                    </TableCell>
                  </TableRow>
                )}
                {referredUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="max-w-[240px] truncate font-medium">
                      {u.email || u.id.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          u.billing === "paid"
                            ? "capitalize border-emerald/40 bg-emerald/10 text-emerald"
                            : "capitalize border-border text-muted-foreground"
                        }
                      >
                        {u.billing}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {u.tier}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(u.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Commissions</CardTitle>
          <CardDescription>
            Earned on each Pro renewal while the subscriber stays on Pro
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Your share</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-20 text-center text-sm text-muted-foreground"
                    >
                      No commissions yet — share your link to get started
                    </TableCell>
                  </TableRow>
                )}
                {commissions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(c.createdAt)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatMoney(c.invoiceAmountCents, c.currency)}
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">
                      {formatMoney(c.amountCents, c.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          c.status === "paid"
                            ? "border-emerald/40 text-emerald"
                            : "border-amber-500/40 text-amber-700 dark:text-amber-300"
                        }
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-1 py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
