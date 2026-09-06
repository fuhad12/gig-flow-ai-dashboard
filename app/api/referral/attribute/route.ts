import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { attributeReferralToUser, REF_COOKIE } from "@/lib/referral"
import { createSupabaseServer } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Persist first-touch referral from jf_ref cookie onto the signed-in profile.
 */
export async function POST() {
  const supabase = await createSupabaseServer()
  if (!supabase) {
    return NextResponse.json(
      { error: "Auth is not configured" },
      { status: 500 },
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  const jar = await cookies()
  const code = jar.get(REF_COOKIE)?.value
  if (!code) {
    return NextResponse.json({ attributed: false, reason: "no_cookie" })
  }

  const result = await attributeReferralToUser(user.id, code)
  return NextResponse.json(result)
}
