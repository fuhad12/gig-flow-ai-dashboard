import { NextResponse } from "next/server"

import {
  getActiveInfluencerByCode,
  REF_COOKIE,
  REF_COOKIE_MAX_AGE_SEC,
} from "@/lib/referral"
import { getSiteUrl } from "@/lib/stripe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Public referral landing: /r/{code}
 * Sets jf_ref cookie when the influencer is active, then redirects home.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params
  const site = getSiteUrl()
  const influencer = await getActiveInfluencerByCode(code)

  const res = NextResponse.redirect(new URL("/", site), 302)

  if (influencer) {
    res.cookies.set(REF_COOKIE, influencer.code, {
      path: "/",
      maxAge: REF_COOKIE_MAX_AGE_SEC,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    })
  }

  return res
}
