import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Refreshes the Supabase session cookie on every request so Server Components
 * and Route Handlers see a fresh user. No auth gating here — that lives in
 * the actual pages and routes.
 *
 * Resilience guarantees:
 *   - If Supabase env vars are missing, skip auth entirely.
 *   - If the Supabase host can't be reached (DNS failure, offline dev,
 *     paused project), bail out fast instead of hanging the request for
 *     the default 30s+ fetch timeout. Without this, every page load
 *     stalls for ~30s when the dev box is offline and spams the logs
 *     with `getaddrinfo ENOTFOUND` traces.
 *   - The session cookie just doesn't refresh on that request; routes
 *     and pages still see whatever cookie the browser already has, and
 *     handle absent users normally.
 */

const AUTH_REFRESH_TIMEOUT_MS = 4_000

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return response

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        )
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // Race the auth refresh against a short timeout. Whichever resolves
  // first wins. The auth result is discarded either way; we only call
  // `getUser` so the SDK rotates cookies when the access token is
  // expiring. Failing is fine; routes can still authorise from the
  // existing cookie or return a normal 401.
  try {
    await Promise.race([
      supabase.auth.getUser(),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("auth-refresh-timeout")),
          AUTH_REFRESH_TIMEOUT_MS,
        ),
      ),
    ])
  } catch (err) {
    // Don't blow up the request just because Supabase is unreachable.
    // Log a single, quiet line so devs notice but don't get drowned in
    // ENOTFOUND stack traces.
    if (process.env.NODE_ENV !== "production") {
      const reason =
        err instanceof Error ? err.message : "unknown auth refresh error"
      console.warn(`[middleware] Skipping auth refresh: ${reason}`)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Skip static assets and Next internals; everything else needs session refresh.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
