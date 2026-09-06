import { redirect } from "next/navigation"

import { AdminDashboard } from "@/components/admin-dashboard"
import { isAdminEmail } from "@/lib/admin"
import { createSupabaseServer } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    redirect("/")
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth?next=/admin")
  }

  if (!isAdminEmail(user.email)) {
    redirect("/")
  }

  return (
    <main className="min-h-screen bg-background">
      <AdminDashboard adminEmail={user.email ?? ""} />
    </main>
  )
}
