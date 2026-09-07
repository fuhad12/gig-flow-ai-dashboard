"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BarChart3,
  Loader2,
  Mail,
  Lock,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Eye,
  EyeOff,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { createSupabaseBrowser } from "@/lib/supabase/browser"

type Mode = "signin" | "signup" | "forgot"

interface AuthViewProps {
  initialError?: string
  /** Safe internal path to land on after password sign-in (e.g. /admin). */
  nextPath?: string
}

export function AuthView({ initialError, nextPath = "/" }: AuthViewProps) {
  const router = useRouter()
  const supabase = createSupabaseBrowser()

  const [mode, setMode] = useState<Mode>("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [info, setInfo] = useState<string | null>(null)

  // Surface link-callback errors that come in via the URL.
  useEffect(() => {
    if (initialError) setError(initialError)
  }, [initialError])

  // Reset visibility when leaving password fields (forgot mode).
  useEffect(() => {
    if (mode === "forgot") setShowPassword(false)
  }, [mode])

  const afterAuthPath =
    nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/"

  const callbackUrl = (next?: string) => {
    if (typeof window === "undefined") return undefined
    const url = new URL("/auth/callback", window.location.origin)
    if (next) url.searchParams.set("next", next)
    return url.toString()
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError("Email is required")
      return
    }

    if (mode !== "forgot") {
      if (!password) {
        setError("Password is required")
        return
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters")
        return
      }
    }

    setLoading(true)
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        })
        if (error) throw error
        router.refresh()
        router.replace(afterAuthPath)
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            emailRedirectTo: callbackUrl(afterAuthPath),
          },
        })
        if (error) throw error
        if (data.session) {
          router.refresh()
          router.replace(afterAuthPath)
        } else {
          setInfo(
            "We sent a verification link to your email. Click it to finish signing up.",
          )
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(
          trimmedEmail,
          {
            redirectTo: callbackUrl("/auth/update-password"),
          },
        )
        if (error) throw error
        setInfo(
          "If an account exists for that email, we just sent a password reset link.",
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const heading =
    mode === "signin"
      ? "Welcome back"
      : mode === "signup"
        ? "Create your account"
        : "Reset your password"

  const subheading =
    mode === "signin"
      ? "Sign in to optimize Fiverr gigs and win more Upwork jobs"
      : mode === "signup"
        ? "Rank Fiverr gigs and write winning Upwork proposals — free to start"
        : "Enter your email and we'll send you a reset link"

  const submitLabel = (() => {
    if (loading) {
      return mode === "signin"
        ? "Signing in..."
        : mode === "signup"
          ? "Creating account..."
          : "Sending link..."
    }
    if (mode === "signin") return "Sign in"
    if (mode === "signup") return "Create account"
    return "Send reset link"
  })()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-emerald text-primary-foreground">
            <BarChart3 className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            JobFlow AI
          </span>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-lg shadow-black/20">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-foreground">{heading}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subheading}</p>
          </div>

          {mode !== "forgot" && (
            <Tabs
              value={mode}
              onValueChange={(v) => switchMode(v as Mode)}
              className="mb-5"
            >
              <TabsList className="grid w-full grid-cols-2 bg-secondary">
                <TabsTrigger
                  value="signin"
                  className="data-[state=active]:bg-card data-[state=active]:text-emerald"
                >
                  Sign in
                </TabsTrigger>
                <TabsTrigger
                  value="signup"
                  className="data-[state=active]:bg-card data-[state=active]:text-emerald"
                >
                  Sign up
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  placeholder="you@example.com"
                  className="h-11 w-full rounded-lg border border-border bg-secondary pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald focus:ring-1 focus:ring-emerald/40 focus:outline-none disabled:opacity-50 transition-colors"
                />
              </div>
            </div>

            {mode !== "forgot" && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-xs font-medium text-muted-foreground"
                  >
                    Password
                  </label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs font-medium text-emerald hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    placeholder={
                      mode === "signup"
                        ? "At least 6 characters"
                        : "Your password"
                    }
                    className="h-11 w-full rounded-lg border border-border bg-secondary pl-10 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald focus:ring-1 focus:ring-emerald/40 focus:outline-none disabled:opacity-50 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={loading}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {info && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald/30 bg-emerald/10 px-3 py-2 text-xs text-emerald">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                <span>{info}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !email.trim() || (mode !== "forgot" && !password)}
              className="h-11 bg-emerald text-sm font-semibold text-primary-foreground hover:bg-emerald/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {submitLabel}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {mode === "forgot" ? (
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="inline-flex items-center gap-1 font-medium text-emerald hover:underline"
            >
              <ArrowLeft className="size-3" />
              Back to sign in
            </button>
          ) : (
            <>
              {mode === "signin"
                ? "New to JobFlow AI?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                className="font-medium text-emerald hover:underline"
              >
                {mode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
