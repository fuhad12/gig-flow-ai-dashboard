"use client"

/**
 * Admin influencers: create referral partners, toggle active, mark commissions paid.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react"
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Megaphone,
  Plus,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

interface Influencer {
  id: string
  code: string
  name: string
  email: string
  commissionPct: number
  active: boolean
  createdAt: string
  referralUrl: string
}

interface Commission {
  id: string
  influencerId: string
  userId: string
  userEmail: string
  stripeInvoiceId: string
  amountCents: number
  invoiceAmountCents: number
  currency: string
  status: string
  createdAt: string
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

function slugifyCode(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
}

export function AdminInfluencersView() {
  const [influencers, setInfluencers] = useState<Influencer[]>([])
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterId, setFilterId] = useState<string>("")

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [commissionPct, setCommissionPct] = useState("20")
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filterId) params.set("influencer_id", filterId)
      const [infRes, comRes] = await Promise.all([
        fetch("/api/admin/influencers"),
        fetch(`/api/admin/commissions?${params}`),
      ])
      const infData = (await infRes.json()) as {
        influencers?: Influencer[]
        error?: string
      }
      const comData = (await comRes.json()) as {
        commissions?: Commission[]
        error?: string
      }
      if (!infRes.ok) throw new Error(infData.error || "Failed to load influencers")
      if (!comRes.ok) throw new Error(comData.error || "Failed to load commissions")
      setInfluencers(infData.influencers ?? [])
      setCommissions(comData.commissions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [filterId])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/influencers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          code: code || slugifyCode(name),
          commissionPct: parseFloat(commissionPct) || 20,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Create failed")
      setName("")
      setEmail("")
      setCode("")
      setCommissionPct("20")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed")
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (inf: Influencer) => {
    setError(null)
    const res = await fetch(`/api/admin/influencers/${inf.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !inf.active }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) {
      setError(data.error || "Update failed")
      return
    }
    await load()
  }

  const markPaid = async (id: string) => {
    setError(null)
    const res = await fetch(`/api/admin/commissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid" }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) {
      setError(data.error || "Update failed")
      return
    }
    await load()
  }

  const copyLink = async (inf: Influencer) => {
    try {
      await navigator.clipboard.writeText(inf.referralUrl)
      setCopiedId(inf.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" />
            Create influencer
          </CardTitle>
          <CardDescription>
            They sign in with this email. A Partner link appears in their
            sidebar (or open /influencer). Share the referral
            link — users never type a code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleCreate}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <div className="space-y-1.5">
              <Label htmlFor="inf-name">Name</Label>
              <Input
                id="inf-name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (!code) setCode(slugifyCode(e.target.value))
                }}
                placeholder="Alex Creator"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inf-email">Email</Label>
              <Input
                id="inf-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inf-code">Code</Label>
              <Input
                id="inf-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase())}
                placeholder="alex-creator"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inf-pct">Commission %</Label>
              <Input
                id="inf-pct"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={commissionPct}
                onChange={(e) => setCommissionPct(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={creating}
                className="w-full gap-2 bg-emerald text-primary-foreground hover:bg-emerald/90"
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Megaphone className="size-4" />
                )}
                Create
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Influencers</CardTitle>
          <CardDescription>
            {influencers.length} partner{influencers.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">
                      <Loader2 className="mx-auto size-4 animate-spin text-emerald" />
                    </TableCell>
                  </TableRow>
                )}
                {!loading && influencers.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-20 text-center text-sm text-muted-foreground"
                    >
                      No influencers yet
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  influencers.map((inf) => (
                    <TableRow key={inf.id}>
                      <TableCell className="font-medium">{inf.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {inf.email}
                      </TableCell>
                      <TableCell>{inf.commissionPct}%</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-xs"
                          onClick={() => void copyLink(inf)}
                        >
                          {copiedId === inf.id ? (
                            <>
                              <Check className="size-3.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="size-3.5" />
                              /r/{inf.code}
                            </>
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            inf.active
                              ? "border-emerald/40 text-emerald"
                              : "text-muted-foreground"
                          }
                        >
                          {inf.active ? "Active" : "Off"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setFilterId((id) => (id === inf.id ? "" : inf.id))
                            }
                          >
                            {filterId === inf.id ? "Clear filter" : "Commissions"}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => void toggleActive(inf)}
                          >
                            {inf.active ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
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
            Recurring Pro invoice share
            {filterId ? " · filtered" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Subscriber</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && commissions.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-20 text-center text-sm text-muted-foreground"
                    >
                      No commissions yet
                    </TableCell>
                  </TableRow>
                )}
                {commissions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(c.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {c.userEmail || c.userId.slice(0, 8)}
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
                    <TableCell className="text-right">
                      {c.status === "pending" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void markPaid(c.id)}
                        >
                          Mark paid
                        </Button>
                      )}
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
