"use client"

/**
 * Admin shell — Users (read-only) + Influencers (referral partners).
 */

import Link from "next/link"
import { Shield } from "lucide-react"

import { AdminUsersView } from "@/components/admin-users-view"
import { AdminInfluencersView } from "@/components/admin-influencers-view"
import { InfluencerLeaderboard } from "@/components/influencer-leaderboard"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface AdminDashboardProps {
  adminEmail: string
}

export function AdminDashboard({ adminEmail }: AdminDashboardProps) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground sm:text-2xl">
            <Shield className="size-5 text-emerald" />
            Admin
          </h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {adminEmail}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to app</Link>
        </Button>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="influencers">Influencers</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4">
          <AdminUsersView adminEmail={adminEmail} embedded />
        </TabsContent>
        <TabsContent value="influencers" className="mt-4">
          <AdminInfluencersView />
        </TabsContent>
        <TabsContent value="leaderboard" className="mt-4">
          <InfluencerLeaderboard />
        </TabsContent>
      </Tabs>
    </div>
  )
}
