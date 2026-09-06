import { redirect } from "next/navigation"

import { AuthView } from "@/components/auth-view"
import { SetupRequired } from "@/components/setup-required"
import { createSupabaseServer } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

interface AuthPageProps {
  searchParams: Promise<{ error?: string; next?: string }>
}

function sanitizeNext(raw: string | undefined): string {
  if (!raw) return "/"
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return <SetupRequired />
  }

  const params = await searchParams
  const next = sanitizeNext(params.next)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect(next)
  }

  return <AuthView initialError={params.error} nextPath={next} />
}
