"use client"

/**
 * Read-only admin user list — search, pagination, plan + credits.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Shield,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

import type { AdminUserRow } from "@/lib/admin-types"

interface AdminUsersViewProps {
  adminEmail: string
  /** When true, omit page chrome (used inside AdminDashboard tabs). */
  embedded?: boolean
}

interface UsersResponse {
  users?: AdminUserRow[]
  total?: number
  page?: number
  limit?: number
  error?: string
}

const PAGE_SIZE = 50

function formatDate(iso: string | null): string {
  if (!iso) return "—"
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

function tierBadgeClass(tier: string): string {
  if (tier === "agency") return "border-amber-500/40 text-amber-700 dark:text-amber-300"
  if (tier === "pro") return "border-emerald/40 text-emerald"
  return "border-border text-muted-foreground"
}

export function AdminUsersView({
  adminEmail,
  embedded = false,
}: AdminUsersViewProps) {
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      if (search.trim()) params.set("q", search.trim())

      const res = await fetch(`/api/admin/users?${params}`)
      const data = (await res.json()) as UsersResponse
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      setUsers(data.users ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users")
      setUsers([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    void load()
  }, [load])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(q)
  }

  return (
    <div
      className={
        embedded
          ? "space-y-6"
          : "mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6"
      }
    >
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground sm:text-2xl">
              <Shield className="size-5 text-emerald" />
              Admin
            </h1>
            <p className="text-sm text-muted-foreground">
              Read-only user directory · signed in as {adminEmail}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to app</Link>
          </Button>
        </div>
      )}

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" />
                Users
              </CardTitle>
              <CardDescription>
                {total} account{total === 1 ? "" : "s"}
              </CardDescription>
            </div>
            <form
              onSubmit={handleSearch}
              className="flex w-full max-w-sm items-center gap-2 sm:w-auto"
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search email…"
                  className="pl-8"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary">
                Search
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Credits (mo)</TableHead>
                  <TableHead>Top-ups</TableHead>
                  <TableHead>Signed up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin text-emerald" />
                        Loading users…
                      </span>
                    </TableCell>
                  </TableRow>
                )}
                {!loading && users.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-24 text-center text-sm text-muted-foreground"
                    >
                      No users found
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="max-w-[220px] truncate font-medium">
                        {u.email || u.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`capitalize ${tierBadgeClass(u.tier)}`}
                        >
                          {u.tier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {u.subscriptionStatus ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {u.subscriptionPlan ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {u.creditsUsed}/{u.creditLimit}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {u.topupBalance}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(u.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-4" />
                Prev
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
