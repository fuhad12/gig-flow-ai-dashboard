import { redirect } from "next/navigation"

import { UpdatePasswordForm } from "@/components/update-password-form"
import { SetupRequired } from "@/components/setup-required"
import { createSupabaseServer } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function UpdatePasswordPage() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return <SetupRequired />
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Reset link → /auth/callback → session is set → arrives here as signed in.
  // If a user lands here without a session (link expired, opened in a fresh
  // browser, etc.), bounce them back to /auth.
  if (!user) {
    redirect("/auth?error=Reset+link+is+invalid+or+expired")
  }

  return <UpdatePasswordForm email={user.email ?? ""} />
}
