"use client"

/**
 * Shared influencer competition board — ranks by paid conversions, then
 * signups, then commissions earned.
 */

import { useCallback, useEffect, useState } from "react"
import { Loader2, Trophy } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"

export type LeaderboardPeriod = "all" | "month"

interface LeaderboardEntry {
  rank: number
  id: string
  name: string
  code: string
  referredSignups: number
  paidConversions: number
  pendingCents: number
  paidCents: number
  totalEarnedCents: number
}

interface LeaderboardResponse {
  period?: LeaderboardPeriod
  viewerInfluencerId?: string | null
  entries?: LeaderboardEntry[]
  error?: string
}

function formatMoney(cents: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(0)}`
  }
}

function rankClass(rank: number): string {
  if (rank === 1) return "bg-amber-500/15 text-amber-700 dark:text-amber-300"
  if (rank === 2) return "bg-muted text-foreground"
  if (rank === 3) return "bg-orange-500/10 text-orange-700 dark:text-orange-300"
  return "bg-transparent text-muted-foreground"
}

interface InfluencerLeaderboardProps {
  /** Compact when embedded under partner stats. */
  compact?: boolean
  className?: string
}

export function InfluencerLeaderboard({
  compact = false,
  className,
}: InfluencerLeaderboardProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("month")
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/influencer/leaderboard?period=${period}`,
      )
      const data = (await res.json()) as LeaderboardResponse
      if (!res.ok) throw new Error(data.error || "Failed to load leaderboard")
      setEntries(data.entries ?? [])
      setViewerId(data.viewerInfluencerId ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card className={cn("border-border bg-card", className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-emerald" />
              Partner leaderboard
            </CardTitle>
            <CardDescription>
              Ranked by paid conversions, then signups — climb the board by
              sharing your link
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={period === "month" ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setPeriod("month")}
            >
              This month
            </Button>
            <Button
              type="button"
              size="sm"
              variant={period === "all" ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setPeriod("all")}
            >
              All time
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-3 text-sm text-danger">{error}</p>
        )}
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">#</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Signups</TableHead>
                {!compact && (
                  <TableHead className="text-right">Earned</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell
                    colSpan={compact ? 4 : 5}
                    className="h-20 text-center"
                  >
                    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin text-emerald" />
                      Loading ranks…
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {!loading && entries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={compact ? 4 : 5}
                    className="h-20 text-center text-sm text-muted-foreground"
                  >
                    No active partners yet
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                entries.map((e) => {
                  const isYou = viewerId === e.id
                  return (
                    <TableRow
                      key={e.id}
                      className={cn(isYou && "bg-emerald/5")}
                    >
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                            rankClass(e.rank),
                          )}
                        >
                          {e.rank}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {e.name}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              /r/{e.code}
                            </p>
                          </div>
                          {isYou && (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-emerald/40 text-emerald"
                            >
                              You
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {e.paidConversions}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {e.referredSignups}
                      </TableCell>
                      {!compact && (
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatMoney(e.totalEarnedCents)}
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
