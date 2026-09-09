"use client"

/**
 * Profile Optimizer — paste a public Fiverr/Upwork profile URL.
 * We scrape the live page, score professionalism, and return paste-ready rewrites.
 */

import { useMemo, useState, type FormEvent } from "react"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type {
  ProfileOptimization,
  ProfilePlatform,
  ProfileVerdict,
} from "@/lib/profile-optimizer-types"
import { detectProfilePlatform } from "@/lib/profile-optimizer-types"
import { VisibilityPanel } from "@/components/visibility-panel"
import { DEFAULT_PROFILE_CHECKLIST } from "@/lib/visibility-types"

interface ProfileOptimizerViewProps {
  onCreditStart?: () => boolean
  onCreditUsed?: () => void
  onUpgrade?: () => void
}

export function ProfileOptimizerView({
  onCreditStart,
  onCreditUsed,
  onUpgrade,
}: ProfileOptimizerViewProps) {
  const [profileUrl, setProfileUrl] = useState("")
  const [platformOverride, setPlatformOverride] = useState<
    ProfilePlatform | "auto"
  >("auto")
  const [tone, setTone] = useState<"professional" | "friendly" | "direct">(
    "professional",
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProfileOptimization | null>(null)

  const detected = useMemo(
    () => (profileUrl.trim() ? detectProfilePlatform(profileUrl.trim()) : null),
    [profileUrl],
  )
  const platform: ProfilePlatform | null =
    platformOverride === "auto" ? detected : platformOverride

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (!platform) {
      setError(
        "Paste a fiverr.com or upwork.com profile URL, or pick the platform manually.",
      )
      return
    }
    if (onCreditStart && !onCreditStart()) return

    setLoading(true)
    try {
      const res = await fetch("/api/profile-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileUrl,
          platform,
          tone,
        }),
      })
      const data = (await res.json()) as {
        optimization?: ProfileOptimization
        error?: string
      }
      if (res.status === 402) {
        onUpgrade?.()
        throw new Error(data.error || "Out of AI credits")
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      if (!data.optimization) {
        throw new Error("No optimization returned")
      }
      setResult(data.optimization)
      onCreditUsed?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground sm:text-2xl">
          <UserRound className="size-5 text-emerald" />
          Profile Optimizer
        </h1>
        <p className="text-sm text-muted-foreground">
          Paste your public Fiverr or Upwork profile link. We pull the live
          text, score how professional it reads, and give you paste-ready
          rewrites — 1 AI credit.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your live profile</CardTitle>
            <CardDescription>
              Use a public profile URL. We read what&apos;s visible without
              logging in — private or login-walled pages won&apos;t work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-url">Profile URL *</Label>
                <Input
                  id="profile-url"
                  type="url"
                  required
                  value={profileUrl}
                  onChange={(e) => setProfileUrl(e.target.value)}
                  placeholder="https://www.fiverr.com/username or https://www.upwork.com/freelancers/…"
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {platform ? (
                    <Badge
                      variant="outline"
                      className="border-emerald/40 text-emerald capitalize"
                    >
                      {platform}
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      Platform not detected yet
                    </span>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Platform</Label>
                  <Select
                    value={platformOverride}
                    onValueChange={(v) =>
                      setPlatformOverride(v as ProfilePlatform | "auto")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto from URL</SelectItem>
                      <SelectItem value="fiverr">Fiverr</SelectItem>
                      <SelectItem value="upwork">Upwork</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tone">Tone</Label>
                  <Select
                    value={tone}
                    onValueChange={(v) =>
                      setTone(v as "professional" | "friendly" | "direct")
                    }
                  >
                    <SelectTrigger id="tone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="friendly">Friendly</SelectItem>
                      <SelectItem value="direct">Direct</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || !profileUrl.trim()}
                className="w-full gap-2 bg-emerald text-primary-foreground hover:bg-emerald/90"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Reading profile…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Optimize profile
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!result && !loading && (
            <Card className="border-dashed border-border bg-card/50">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Target className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Your professionalism score and optimized copy will show up
                  here.
                </p>
              </CardContent>
            </Card>
          )}

          {loading && (
            <Card className="border-border bg-card">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-emerald" />
                <span>Pulling your live profile…</span>
                <span className="text-xs">Then scoring & rewriting</span>
              </CardContent>
            </Card>
          )}

          {result && <OptimizationResult result={result} />}
        </div>
      </div>
    </div>
  )
}

function verdictStyles(verdict: ProfileVerdict): {
  card: string
  badge: string
  label: string
} {
  if (verdict === "needs_work") {
    return {
      card: "border-amber-500/40 bg-amber-500/10",
      badge: "border-amber-500/50 text-amber-700 dark:text-amber-300",
      label: "Needs more professional polish",
    }
  }
  if (verdict === "solid") {
    return {
      card: "border-sky-500/30 bg-sky-500/5",
      badge: "border-sky-500/40 text-sky-700 dark:text-sky-300",
      label: "Solid — room to tighten",
    }
  }
  return {
    card: "border-emerald/30 bg-emerald/5",
    badge: "border-emerald/40 text-emerald",
    label: "Strong profile signals",
  }
}

function OptimizationResult({ result }: { result: ProfileOptimization }) {
  const styles = verdictStyles(result.verdict)

  return (
    <div className="space-y-4">
      <Card className={styles.card}>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-foreground/70" />
              <span className="text-sm font-medium text-foreground">
                Current profile score
              </span>
              <Badge variant="outline" className={styles.badge}>
                {Math.round(result.score)}/100
              </Badge>
            </div>
            <Badge variant="outline" className="capitalize">
              {result.platform}
            </Badge>
          </div>
          <p className="text-sm font-medium text-foreground">{styles.label}</p>
          <p className="text-sm text-muted-foreground">{result.verdictLabel}</p>
        </CardContent>
      </Card>

      {result.scraped &&
        (result.scraped.headline || result.scraped.overview) && (
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">What we found</CardTitle>
              <CardDescription className="text-xs">
                Pulled from your public URL
                {result.scraped.displayName
                  ? ` · ${result.scraped.displayName}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {result.scraped.headline && (
                <p>
                  <span className="font-medium text-foreground">Title: </span>
                  {result.scraped.headline}
                </p>
              )}
              {result.scraped.overview && (
                <p className="line-clamp-4 whitespace-pre-wrap">
                  {result.scraped.overview}
                </p>
              )}
              {result.scraped.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {result.scraped.skills.slice(0, 8).map((s) => (
                    <Badge key={s} variant="secondary" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-sm">
              {result.platform === "fiverr"
                ? "Professional title"
                : "Profile headline"}
            </CardTitle>
            <CardDescription className="text-xs">
              {result.platform === "upwork"
                ? `${result.headline.length}/70 characters · paste into your live profile`
                : "Paste into your live profile"}
            </CardDescription>
          </div>
          <CopyButton text={result.headline} />
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium text-foreground">
            {result.headline}
          </p>
        </CardContent>
      </Card>

      {result.suggestedRateUsd != null && (
        <Card
          className={
            result.accountStage === "getting_started"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-emerald/30 bg-emerald/5"
          }
        >
          <CardHeader className="pb-2">
            <CardTitle
              className={`text-sm ${
                result.accountStage === "getting_started"
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-emerald"
              }`}
            >
              {result.suggestedRateLabel}
            </CardTitle>
            <CardDescription className="text-xs">
              {[
                result.accountStageLabel,
                result.rateFamilyLabel
                  ? `${result.rateFamilyLabel} market`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") ||
                "Matched to your niche + traction — not a fantasy premium rate"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              ${result.suggestedRateUsd}
              {result.platform === "upwork" ? (
                <span className="text-sm font-normal text-muted-foreground">
                  /hr
                </span>
              ) : null}
            </p>
            {result.suggestedRateNote && (
              <p className="text-sm text-muted-foreground">
                {result.suggestedRateNote}
              </p>
            )}
            {result.accountStage === "getting_started" && (
              <p className="pt-1 text-xs text-muted-foreground">
                Right now, win jobs by standing out (specific niche title,
                clear offer, portfolio samples) — raise rates after 3–5 strong
                reviews.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-sm">
              {result.platform === "fiverr" ? "Description" : "Overview"}
            </CardTitle>
            <CardDescription className="text-xs">
              {result.platform === "upwork"
                ? `${result.overview.length.toLocaleString()} characters · target 2,000–3,500 (max 5,000)`
                : `${result.overview.split(/\s+/).filter(Boolean).length} words`}
            </CardDescription>
          </div>
          <CopyButton text={result.overview} />
        </CardHeader>
        <CardContent className="space-y-3">
          {result.platform === "upwork" && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Clients only see the first ~250 characters in search before “Read
              more” — that opening must hook them.
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {result.overview}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-sm">Skills</CardTitle>
            <CardDescription className="text-xs">
              Suggested labels for the platform
            </CardDescription>
          </div>
          <CopyButton text={result.skills.join(", ")} />
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {result.skills.map((s) => (
            <Badge key={s} variant="secondary" className="text-xs">
              {s}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What was weak</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 pl-4 text-sm text-muted-foreground [&>li]:list-disc">
            {result.critique.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Why this wins</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 pl-4 text-sm text-muted-foreground [&>li]:list-disc">
            {result.winAngles.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <VisibilityPanel
        title="Be findable — and recommendable"
        description="Snippet-first overview (AEO) + citable proof (GEO) + consistent niche (AIO)."
        proofQuotes={result.proofQuotes}
        answerReadinessNotes={result.geoTips}
        checklist={
          result.visibilityChecklist?.length
            ? result.visibilityChecklist
            : DEFAULT_PROFILE_CHECKLIST
        }
      />

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-amber-700 dark:text-amber-300">
            Action plan
          </CardTitle>
          <CardDescription className="text-xs">
            Do these in order on your live {result.platform === "upwork" ? "Upwork" : "Fiverr"} profile
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {(result.actionPlan?.length
              ? result.actionPlan
              : (result.editChecklist ?? []).map((line) => ({
                  title: line,
                  detail: "",
                }))
            ).map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {step.title}
                  </p>
                  {step.detail ? (
                    <p className="text-sm text-muted-foreground">{step.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // ignore
        }
      }}
    >
      {copied ? (
        <>
          <Check className="size-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" />
          Copy
        </>
      )}
    </Button>
  )
}
