"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  BarChart3,
  Loader2,
  Lock,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { createSupabaseBrowser } from "@/lib/supabase/browser"

interface UpdatePasswordFormProps {
  email: string
}

export function UpdatePasswordForm({ email }: UpdatePasswordFormProps) {
  const router = useRouter()
  const supabase = createSupabaseBrowser()

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (password.length < 6) {
      setError("Password must be at least 6 characters")
      return
    }
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setInfo("Password updated. Redirecting...")
      router.refresh()
      // Tiny delay so the success state is visible.
      setTimeout(() => router.replace("/"), 600)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
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
            <h1 className="text-xl font-bold text-foreground">
              Set a new password
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {email ? (
                <>
                  For <span className="font-medium text-foreground">{email}</span>
                </>
              ) : (
                "Choose a new password to finish resetting your account"
              )}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                New password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="At least 6 characters"
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

            <div>
              <label
                htmlFor="confirm"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="confirm"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={loading}
                  placeholder="Re-enter your new password"
                  className="h-11 w-full rounded-lg border border-border bg-secondary pl-10 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald focus:ring-1 focus:ring-emerald/40 focus:outline-none disabled:opacity-50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  disabled={loading}
                  aria-label={
                    showConfirm ? "Hide confirm password" : "Show confirm password"
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {showConfirm ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

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
              disabled={loading || !password || !confirm}
              className="h-11 bg-emerald text-sm font-semibold text-primary-foreground hover:bg-emerald/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {loading ? "Updating..." : "Update password"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
