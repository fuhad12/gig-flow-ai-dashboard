"use client"

/**
 * Settings page — billing, account, danger zone.
 *
 * Three real sections (no placeholder toggles):
 *   1. Subscription      — current plan, AI credit usage, cancel via Flutterwave.
 *   2. Account           — email (read-only), change password.
 *   3. Danger Zone       — delete account (with confirmation modal).
 *
 * Hosted inside the dashboard view stack via the existing sidebar.
 */

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  Bell,
  CheckCircle2,
  CreditCard,
  Globe,
  Loader2,
  LogOut,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  User as UserIcon,
  X,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import { createSupabaseBrowser } from "@/lib/supabase/browser"
import {
  NICHES,
  getNicheDisplayName,
  isCustomNiche,
  slugifyNiche,
} from "@/lib/niches"
import { OperationalHealthCard } from "@/components/operational-health-card"

type SettingsPlan =
  | "pro-monthly"
  | "pro-yearly"
  | "agency-monthly"
  | "agency-yearly"

export interface SettingsViewProps {
  user: { id: string; email: string }
  isPremium: boolean
  tier: "free" | "pro" | "agency"
  subscriptionPlan: SettingsPlan | null
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  // Monthly AI credit pool — see lib/quota.ts.
  creditsUsed: number
  creditLimit: number
  // Top-up balance carried across months. Always shown separately so the
  // user can verify each purchase's contribution.
  topupBalance: number
  onUpgrade: () => void
  onBuyCredits: () => void
  /**
   * Seed values from the server-rendered profile snapshot. The NichesCard
   * still refetches on mount to stay authoritative, but using these as the
   * initial draft state removes the first-paint loading flicker — which is
   * especially noticeable when the dashboard auto-lands on Settings for
   * first-time users.
   */
  initialSelectedNiches?: string[]
  initialSkillTags?: string[]
  /**
   * First-run flag. When true, Settings renders a prominent welcome banner
   * above the cards directing the user to fill in the niches card. The
   * banner disappears the moment the user saves niches OR explicitly
   * dismisses it (both calls hit PATCH /api/profile/niches which sets
   * `profiles.onboarded_at`, so reloads don't bring it back).
   */
  showOnboardingBanner?: boolean
  /** Fired after a successful save or explicit dismiss. */
  onOnboardingComplete?: () => void
}

export function SettingsView(props: SettingsViewProps) {
  // Ref on the niches card so the onboarding banner can scroll the user
  // straight to it (the banner itself sits above the billing card, which
  // can push the niches card below the fold on smaller screens).
  const nichesRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll the niches card into view the first time we render with
  // the banner active. Without this, the user lands on the page with
  // Subscription at top and might not realize where they're being pointed.
  useEffect(() => {
    if (!props.showOnboardingBanner) return
    // Wait one frame so the card is laid out before scrolling.
    const id = window.requestAnimationFrame(() => {
      nichesRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    })
    return () => window.cancelAnimationFrame(id)
  }, [props.showOnboardingBanner])

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 sm:p-6">
      <div className="mb-5 sm:mb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
          <SettingsIcon className="size-5 text-emerald sm:size-6" />
          Settings
        </h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          Manage your subscription, account, and data.
        </p>
      </div>
      <div className="max-w-2xl space-y-5 sm:space-y-6">
        {props.showOnboardingBanner && (
          <OnboardingBanner
            onScrollToNiches={() =>
              nichesRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
            onDismiss={props.onOnboardingComplete}
          />
        )}
        <BillingCard {...props} />
        <TopupHistoryCard
          topupBalance={props.topupBalance}
          onBuyCredits={props.onBuyCredits}
        />
        <div ref={nichesRef}>
          <NichesCard
            initialSelectedNiches={props.initialSelectedNiches}
            initialSkillTags={props.initialSkillTags}
            highlightOnMount={props.showOnboardingBanner}
            onSaved={props.onOnboardingComplete}
          />
        </div>
        <OperationalHealthCard />
        <AccountCard email={props.user.email} />
        <NotificationsCard />
        <DangerZoneCard />
      </div>
    </div>
  )
}

// ---------- First-run onboarding banner ----------
//
// Rendered above the cards on a user's very first signin (when
// `profiles.onboarded_at IS NULL`). Has two affordances:
//   - primary CTA scrolls to and highlights the niches card
//   - secondary "Skip for now" PATCHes the profile to set onboarded_at,
//     so the user never sees this banner again on subsequent loads.

function OnboardingBanner({
  onScrollToNiches,
  onDismiss,
}: {
  onScrollToNiches: () => void
  onDismiss?: () => void
}) {
  const [dismissing, setDismissing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSkip = async () => {
    setError(null)
    setDismissing(true)
    try {
      // PATCH with the user's current values (empty draft) just to flip
      // `onboarded_at` server-side. We don't pass selectedNiches/skillTags
      // so the route preserves whatever's already there.
      const res = await fetch("/api/profile/niches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(data?.error ?? `HTTP ${res.status}`)
      }
      onDismiss?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss")
      setDismissing(false)
    }
  }

  return (
    <div className="rounded-lg border border-emerald/30 bg-emerald/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald/15">
          <Sparkles className="size-4 text-emerald" />
        </div>
        <div className="flex-1 space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground sm:text-base">
              Welcome — let&apos;s tune JobFlow to your niches.
            </h2>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Pick the Fiverr categories you sell in — Upwork proposals use your
              skills too. JobFlow focuses scrapes on those niches, and AI copy
              reflects your real positioning. You can change this anytime.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={onScrollToNiches}
              className="gap-1.5 bg-emerald text-primary-foreground hover:bg-emerald/90"
            >
              <ArrowDown className="size-3.5" />
              Pick my niches
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSkip}
              disabled={dismissing}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              {dismissing && <Loader2 className="size-3.5 animate-spin" />}
              Skip for now
            </Button>
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Subscription ----------

function planLabel(plan: SettingsPlan | null): string | null {
  if (!plan) return null
  const [tier, cadence] = plan.split("-")
  return `${tier} · ${cadence}`
}

function tierName(tier: "free" | "pro" | "agency"): string {
  if (tier === "agency") return "JobFlow Agency"
  if (tier === "pro") return "JobFlow Pro"
  return "Free plan"
}

function BillingCard({
  isPremium,
  tier,
  subscriptionPlan,
  subscriptionStatus,
  currentPeriodEnd,
  creditsUsed,
  creditLimit,
  topupBalance,
  onUpgrade,
}: Omit<SettingsViewProps, "user" | "onBuyCredits">) {
  const [openingPortal, setOpeningPortal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleManage = async () => {
    setError(null)
    setOpeningPortal(true)
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      const data = (await res.json().catch(() => null)) as {
        error?: string
        url?: string
        canceled?: boolean
        message?: string
      } | null
      if (!res.ok) {
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      if (data?.url) {
        window.location.href = data.url
        return
      }
      // Flutterwave: cancel in-place (no hosted portal URL).
      window.alert(
        data?.message ??
          "Subscription canceled. Refresh the page to see updated status.",
      )
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setOpeningPortal(false)
    }
  }

  // Locale pinned to "en-US" so SSR and hydration agree on the rendered
  // string (Node defaults to en-US, the browser uses the viewer locale,
  // and the diff trips a React hydration mismatch otherwise).
  const renews = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <CreditCard className="size-4 text-emerald" />
          Subscription
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">
              {tierName(tier)}
              {isPremium && subscriptionPlan && (
                <span className="ml-1.5 text-xs font-normal capitalize text-muted-foreground">
                  · {planLabel(subscriptionPlan)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {creditsUsed}/{creditLimit} monthly AI credits used
              {topupBalance > 0 && (
                <> · +{topupBalance} top-up{topupBalance !== 1 ? "s" : ""}</>
              )}
              {isPremium && renews && subscriptionStatus !== "canceled" && (
                <> · renews {renews}</>
              )}
              {subscriptionStatus === "canceled" && renews && (
                <> · ends {renews}</>
              )}
            </div>
          </div>
          {isPremium ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleManage}
              disabled={openingPortal}
              className="gap-1.5"
            >
              {openingPortal && <Loader2 className="size-3.5 animate-spin" />}
              {openingPortal ? "Canceling..." : "Cancel plan"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onUpgrade}
              className="gap-1.5 bg-violet-600 text-white hover:bg-violet-700"
            >
              <Sparkles className="size-3.5" />
              Upgrade
            </Button>
          )}
        </div>
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Top-up history (the "exactly what you paid for" panel) ----------
//
// Every paid top-up pack is listed here with how many credits are still
// unspent. Users can cross-check this against their Flutterwave receipts —
// idempotency on the webhook + the credits_remaining counter guarantee
// the totals match.

interface TopupHistoryItem {
  id: string
  packId: string
  creditsTotal: number
  creditsRemaining: number
  amountPaidCents: number
  currency: string
  createdAt: string
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(2)}`
  }
}

function TopupHistoryCard({
  topupBalance,
  onBuyCredits,
}: {
  topupBalance: number
  onBuyCredits: () => void
}) {
  const [items, setItems] = useState<TopupHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/billing/topups")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error((await res.text()) || `HTTP ${res.status}`)
        }
        return res.json() as Promise<{ topups: TopupHistoryItem[] }>
      })
      .then((data) => {
        if (!cancelled) setItems(data.topups)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed")
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Zap className="size-4 text-emerald" />
          Credit top-ups
        </CardTitle>
        <CardDescription>
          One-time credit packs. They roll forward across months and survive
          subscription cancellation — you keep what you paid for.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {topupBalance} credit{topupBalance !== 1 ? "s" : ""} available
            </div>
            <div className="text-[11px] text-muted-foreground">
              Used after the monthly pool is exhausted.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={onBuyCredits}
          >
            <Plus className="size-3.5" />
            Buy credits
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        {items && items.length === 0 && (
          <div className="text-[11px] text-muted-foreground">
            No top-ups purchased yet.
          </div>
        )}

        {items && items.length > 0 && (
          <ul className="space-y-1.5">
            {items.map((it) => {
              const used = it.creditsTotal - it.creditsRemaining
              return (
                <li
                  key={it.id}
                  className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-xs"
                >
                  <div>
                    <div className="font-medium text-foreground">
                      {it.creditsTotal} credits
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                        · {formatMoney(it.amountPaidCents, it.currency)}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(it.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · {used} used · {it.creditsRemaining} remaining
                    </div>
                  </div>
                  {it.creditsRemaining === 0 ? (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                      Spent
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald/10 px-2 py-0.5 text-[10px] text-emerald">
                      Active
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- My niches & skills ----------
//
// This card replaces the old "everyone gets AI Apps as a default" behavior.
// The user picks:
//   1. The Fiverr categories they actually sell in (niche chips, capped
//      per tier).
//   2. A list of skill tags ("logo designer", "next.js developer",
//      "voiceover artist", …). Stored as a normalized lowercase array.
//
// Both feed:
//   - the Trends UI dropdown (so the niche selector only shows THEIR niches)
//   - the on-demand Firecrawl scrape gate (free-tier scrapes outside the
//     selection are refused server-side)
//   - the AI prompt context (so generated copy reflects what they sell)

interface NichesState {
  selectedNiches: string[]
  skillTags: string[]
  tier: "free" | "pro" | "agency"
  nicheLimit: number
  skillTagLimit: number
}

// Mirrors the server-side constant in app/api/profile/niches/route.ts. The
// server is still authoritative, but the UI uses this to cap the input
// field length and give the user instant feedback.
const SKILL_TAG_MAX_LEN = 40

// Normalize tag input: trim, lowercase, cap length. Empty input → null.
function normalizeTag(raw: string): string | null {
  const t = raw.trim().toLowerCase().slice(0, SKILL_TAG_MAX_LEN)
  return t === "" ? null : t
}

// Compare two ordered string arrays for equality (used for `dirty` check).
function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => b[i] === v)
}

interface NichesCardProps {
  /**
   * Server-rendered seed values. When provided, the card paints the
   * correct selection on first render instead of flashing "Loading…"
   * while it refetches from /api/profile/niches.
   */
  initialSelectedNiches?: string[]
  initialSkillTags?: string[]
  /**
   * When true, the card outlines itself in the brand color so it's
   * unmistakable which card the onboarding banner is pointing at.
   * Auto-clears after the first successful save.
   */
  highlightOnMount?: boolean
  /** Fired after a successful save (used to dismiss the onboarding banner). */
  onSaved?: () => void
}

function NichesCard({
  initialSelectedNiches,
  initialSkillTags,
  highlightOnMount = false,
  onSaved,
}: NichesCardProps) {
  // Seed the persisted state from the server snapshot when we have it,
  // so `dirty` is computed correctly before the network fetch lands and
  // we don't render an empty "Loading…" view on the very screen the
  // onboarding banner is pointing at.
  const [state, setState] = useState<NichesState | null>(() => {
    if (initialSelectedNiches === undefined) return null
    return {
      selectedNiches: initialSelectedNiches,
      skillTags: initialSkillTags ?? [],
      // tier+limits get hydrated from the GET response below; defaults
      // are conservative so the UI doesn't briefly let free users pick
      // more than 1 niche before the real limit lands.
      tier: "free",
      nicheLimit: 1,
      skillTagLimit: 10,
    }
  })
  // Drafts live next to the persisted state so the user can edit without
  // hitting the server on every keystroke. Saved on explicit click.
  const [draftNiches, setDraftNiches] = useState<string[]>(
    initialSelectedNiches ?? [],
  )
  const [draftTags, setDraftTags] = useState<string[]>(initialSkillTags ?? [])
  // Typing buffer for the skill-tag input. Promoted into `draftTags` on
  // Enter / comma / blur / paste.
  const [tagInput, setTagInput] = useState("")
  // Typing buffer for the "add your own niche" input. Slugified on
  // submit and pushed onto `draftNiches` as a custom niche.
  const [customNicheInput, setCustomNicheInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [highlight, setHighlight] = useState(highlightOnMount)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/profile/niches")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
        return res.json() as Promise<NichesState>
      })
      .then((data) => {
        if (cancelled) return
        setState(data)
        // Only overwrite drafts if the user hasn't started editing yet.
        // We detect that by comparing the drafts against the original
        // seed: if they still match (or there was no seed), treat as
        // unedited and refresh; otherwise preserve in-flight edits.
        const seedNiches = initialSelectedNiches ?? []
        const seedTags = initialSkillTags ?? []
        const stillUnedited =
          tagInput === "" &&
          arraysEqual(draftTags, seedTags) &&
          arraysEqual(draftNiches, seedNiches)
        if (stillUnedited) {
          setDraftNiches(data.selectedNiches)
          setDraftTags(data.skillTags)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // One-shot hydration on mount — drafts intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nicheLimit = state?.nicheLimit ?? 3
  const skillTagLimit = state?.skillTagLimit ?? 10
  const tier = state?.tier ?? "free"

  // The "primary" niche is the first one in the array — it's what AI prompts
  // and the generator's default niche use when the user hasn't been explicit.
  const primaryNiche = draftNiches[0] ?? null

  const toggleNiche = (slug: string) => {
    setSuccess(null)
    setError(null)
    setDraftNiches((prev) => {
      if (prev.includes(slug)) {
        return prev.filter((s) => s !== slug)
      }
      if (prev.length >= nicheLimit) {
        setError(
          `Your ${tier} plan caps niche selection at ${nicheLimit}. Remove one first${tier === "free" ? " or upgrade to Pro/Agency for more" : ""}.`,
        )
        return prev
      }
      return [...prev, slug]
    })
  }

  // Promote a niche to "primary" by moving it to index 0. Visible only when
  // there's more than one selected so the action is meaningful.
  const promoteToPrimary = (slug: string) => {
    setDraftNiches((prev) => [slug, ...prev.filter((s) => s !== slug)])
  }

  // Add a user-typed custom niche to the selection. The free text is
  // slugified, validated against the niche-tier cap, and pushed onto the
  // draft. Empty / unparseable input is silently ignored — the input
  // field shows an inline error instead so the user knows what to fix.
  //
  // Returns true if a niche was actually added (so the input can be
  // cleared by the caller).
  const addCustomNiche = (raw: string): boolean => {
    setSuccess(null)
    setError(null)
    const slug = slugifyNiche(raw)
    if (!slug || slug.length < 2) {
      setError(
        "Niche name needs at least 2 letters or numbers (e.g. 'tarot reading').",
      )
      return false
    }
    if (draftNiches.includes(slug)) {
      // Already in the selection (predefined or previously-added custom).
      // Surface this so the user understands why nothing visibly happened.
      setError(`'${getNicheDisplayName(slug)}' is already in your list.`)
      return false
    }
    if (draftNiches.length >= nicheLimit) {
      setError(
        `Your ${tier} plan caps niche selection at ${nicheLimit}. Remove one first${tier === "free" ? " or upgrade to Pro/Agency for more" : ""}.`,
      )
      return false
    }
    setDraftNiches((prev) => [...prev, slug])
    return true
  }

  // Add one or more tags. Accepts a raw string (one tag), a comma-
  // separated list (paste support), or an array. Returns the number of
  // tags actually added — useful for "commit then clear input" flows
  // where we want to know whether the keystroke actually did anything.
  const addTags = (raw: string | string[]): number => {
    setSuccess(null)
    setError(null)
    const candidates = Array.isArray(raw)
      ? raw
      : raw.split(/[,\n]/).map((s) => s.trim())
    let addedCount = 0
    setDraftTags((prev) => {
      const next = [...prev]
      const seen = new Set(next)
      let cappedAt: number | null = null
      for (const c of candidates) {
        const norm = normalizeTag(c)
        if (!norm || seen.has(norm)) continue
        if (next.length >= skillTagLimit) {
          cappedAt = skillTagLimit
          break
        }
        next.push(norm)
        seen.add(norm)
        addedCount += 1
      }
      if (cappedAt !== null) {
        setError(
          `Your ${tier} plan caps skill tags at ${cappedAt}. Remove one first${tier === "free" ? " or upgrade to Pro/Agency for more" : ""}.`,
        )
      }
      return next
    })
    return addedCount
  }

  const removeTag = (tag: string) => {
    setSuccess(null)
    setError(null)
    setDraftTags((prev) => prev.filter((t) => t !== tag))
  }

  const promoteTagToPrimary = (tag: string) => {
    setDraftTags((prev) => [tag, ...prev.filter((t) => t !== tag)])
  }

  // Enter / comma → commit the buffered input as a tag. Backspace on an
  // empty buffer → pop the last tag (standard tag-input convention).
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      if (tagInput.trim() !== "") {
        addTags(tagInput)
        setTagInput("")
      }
    } else if (e.key === "Backspace" && tagInput === "" && draftTags.length > 0) {
      e.preventDefault()
      removeTag(draftTags[draftTags.length - 1])
    }
  }

  const handleTagPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text")
    if (pasted.includes(",") || pasted.includes("\n")) {
      e.preventDefault()
      addTags(pasted)
      setTagInput("")
    }
  }

  // Commit whatever is in the input buffer when the user blurs away
  // (or clicks Save) so they don't lose a half-typed tag.
  const flushPendingTag = () => {
    if (tagInput.trim() !== "") {
      addTags(tagInput)
      setTagInput("")
    }
  }

  const dirty =
    !!state &&
    (!arraysEqual(draftNiches, state.selectedNiches) ||
      !arraysEqual(draftTags, state.skillTags) ||
      tagInput.trim() !== "")

  const handleSave = async () => {
    flushPendingTag()
    setError(null)
    setSuccess(null)
    setSaving(true)
    try {
      const res = await fetch("/api/profile/niches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedNiches: draftNiches,
          skillTags: draftTags,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(data?.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as NichesState
      setState(data)
      setDraftNiches(data.selectedNiches)
      setDraftTags(data.skillTags)
      setSuccess("Saved. The trends page and AI prompts now use your selection.")
      // Tell the parent SettingsView to drop the onboarding banner.
      // We also clear the local highlight so the brand ring fades away
      // now that the user has confirmed their selection.
      setHighlight(false)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  // First-paint shouldn't show the loader if we got seed values from
  // the parent — we already have something useful to render.
  const showLoader = loading && initialSelectedNiches === undefined

  return (
    <Card
      className={
        highlight
          ? "border-emerald/40 bg-card shadow-[0_0_0_3px_rgba(16,185,129,0.12)] transition-shadow"
          : "border-border bg-card"
      }
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Globe className="size-4 text-emerald" />
          My niches &amp; skills
        </CardTitle>
        <CardDescription>
          Pick the categories you actually sell in. The trends page, AI
          prompts, and competitor scrapes all use this selection — so you
          save credits and the output matches your real positioning.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showLoader ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Selected pills */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Selected niches ({draftNiches.length}/{nicheLimit})
              </Label>
              {draftNiches.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-3 text-[11px] text-muted-foreground">
                  Pick one or more niches from the list below, or add your
                  own.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {draftNiches.map((slug, idx) => {
                    // Predefined niches use the catalog name; custom
                    // niches fall back to a Title-Cased version of
                    // their slug. Either way the chip renders something
                    // meaningful — there's no "missing" case.
                    const name = getNicheDisplayName(slug)
                    const custom = isCustomNiche(slug)
                    const isPrimary = idx === 0
                    return (
                      <span
                        key={slug}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${
                          isPrimary
                            ? "border-emerald/40 bg-emerald/10 text-emerald"
                            : "border-border bg-secondary/40 text-foreground"
                        }`}
                      >
                        {isPrimary && (
                          <Sparkles className="size-3 text-emerald" />
                        )}
                        {name}
                        {custom && (
                          <span
                            className="ml-0.5 rounded-sm bg-violet-500/15 px-1 py-px text-[9px] uppercase tracking-wide text-violet-300"
                            title="Custom niche you added"
                          >
                            custom
                          </span>
                        )}
                        {!isPrimary && (
                          <button
                            type="button"
                            onClick={() => promoteToPrimary(slug)}
                            className="ml-0.5 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            title="Make this your primary niche"
                          >
                            set primary
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleNiche(slug)}
                          aria-label={`Remove ${name}`}
                          className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
              {primaryNiche && (
                <p className="text-[10px] text-muted-foreground">
                  Your primary niche is used as the default everywhere in the
                  app. Click <em>set primary</em> on another tag to change it.
                </p>
              )}
            </div>

            {/* Full niche picker */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Available niches
              </Label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {NICHES.map((n) => {
                  const selected = draftNiches.includes(n.slug)
                  const atCap = !selected && draftNiches.length >= nicheLimit
                  return (
                    <button
                      key={n.slug}
                      type="button"
                      disabled={atCap}
                      onClick={() => toggleNiche(n.slug)}
                      className={`rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
                        selected
                          ? "border-emerald/40 bg-emerald/10 text-emerald"
                          : atCap
                            ? "cursor-not-allowed border-border/60 bg-secondary/20 text-muted-foreground/50"
                            : "border-border bg-secondary/40 text-foreground hover:border-foreground/30"
                      }`}
                    >
                      {n.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Custom niche input — for sellers in long-tail Fiverr
                categories (tarot reading, resume writing, pet portraits,
                …) that aren't worth curating in the predefined catalog.
                The AI prompts only need a friendly name, so the slug we
                derive client-side becomes the persisted identifier. */}
            <div className="space-y-1.5">
              <Label htmlFor="custom-niche-input" className="text-xs text-muted-foreground">
                Don&apos;t see your niche? Add it
              </Label>
              <div className="flex gap-1.5">
                <Input
                  id="custom-niche-input"
                  value={customNicheInput}
                  onChange={(e) =>
                    setCustomNicheInput(e.target.value.slice(0, 60))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      if (addCustomNiche(customNicheInput)) {
                        setCustomNicheInput("")
                      }
                    }
                  }}
                  placeholder="e.g. Tarot Reading, Resume Writing, Pet Portraits"
                  disabled={draftNiches.length >= nicheLimit}
                  className="bg-background text-xs"
                  maxLength={60}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (addCustomNiche(customNicheInput)) {
                      setCustomNicheInput("")
                    }
                  }}
                  disabled={
                    customNicheInput.trim() === "" ||
                    draftNiches.length >= nicheLimit
                  }
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Custom niches feed into AI prompts so the analyzer and
                generator produce copy tailored to <em>your</em> service.
                Trends scraping isn&apos;t available for custom niches yet.
              </p>
            </div>

            {/* Skill tags */}
            <div className="space-y-1.5">
              <Label htmlFor="skill-tag-input" className="text-xs text-muted-foreground">
                Skill tags ({draftTags.length}/{skillTagLimit})
              </Label>
              <div
                role="group"
                aria-label="Skill tags"
                className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 focus-within:border-foreground/40"
                onClick={() => {
                  // Tapping anywhere inside the chip area focuses the input.
                  const el = document.getElementById("skill-tag-input")
                  ;(el as HTMLInputElement | null)?.focus()
                }}
              >
                {draftTags.map((tag, idx) => {
                  const isPrimary = idx === 0
                  return (
                    <span
                      key={tag}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                        isPrimary
                          ? "border-emerald/40 bg-emerald/10 text-emerald"
                          : "border-border bg-secondary/40 text-foreground"
                      }`}
                    >
                      {isPrimary && (
                        <Sparkles className="size-3 text-emerald" />
                      )}
                      {tag}
                      {!isPrimary && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            promoteTagToPrimary(tag)
                          }}
                          className="ml-0.5 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          title="Make this your primary skill"
                        >
                          set primary
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeTag(tag)
                        }}
                        aria-label={`Remove ${tag}`}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  )
                })}
                <input
                  id="skill-tag-input"
                  type="text"
                  value={tagInput}
                  onChange={(e) =>
                    // Strip commas live — they're our separator, never part of a tag.
                    setTagInput(e.target.value.replace(/,/g, ""))
                  }
                  onKeyDown={handleTagKeyDown}
                  onPaste={handleTagPaste}
                  onBlur={flushPendingTag}
                  placeholder={
                    draftTags.length === 0
                      ? "Type a skill and press Enter (e.g. logo designer)"
                      : "Add another…"
                  }
                  maxLength={SKILL_TAG_MAX_LEN}
                  disabled={draftTags.length >= skillTagLimit}
                  className="flex-1 min-w-[140px] bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Press <kbd className="rounded border border-border bg-secondary/40 px-1">Enter</kbd>
                {" "}or{" "}
                <kbd className="rounded border border-border bg-secondary/40 px-1">,</kbd>
                {" "}to add a tag. Backspace removes the last one. The first
                tag (
                <span className="inline-flex items-center gap-0.5 text-emerald">
                  <Sparkles className="size-2.5" /> primary
                </span>
                ) is the strongest hint to the AI.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </div>
            )}
            {success && (
              <div className="flex items-start gap-2 rounded-md border border-emerald/30 bg-emerald/10 px-3 py-2 text-xs text-emerald">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> {success}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="gap-1.5"
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {saving ? "Saving…" : "Save preferences"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Account (email + change password) ----------

function AccountCard({ email }: { email: string }) {
  const [pw1, setPw1] = useState("")
  const [pw2, setPw2] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleChangePassword = async () => {
    setError(null)
    setSuccess(null)
    if (pw1.length < 8) {
      setError("New password must be at least 8 characters.")
      return
    }
    if (pw1 !== pw2) {
      setError("Passwords do not match.")
      return
    }
    setSaving(true)
    try {
      const supabase = createSupabaseBrowser()
      const { error: err } = await supabase.auth.updateUser({ password: pw1 })
      if (err) throw new Error(err.message)
      setSuccess("Password updated.")
      setPw1("")
      setPw2("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <UserIcon className="size-4 text-emerald" />
          Account
        </CardTitle>
        <CardDescription>
          Your email is the address you signed up with. Change your password
          below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            value={email}
            readOnly
            className="bg-background/50 text-muted-foreground"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pw1">New password</Label>
            <Input
              id="pw1"
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              placeholder="At least 8 characters"
              className="bg-background"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw2">Confirm new password</Label>
            <Input
              id="pw2"
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="Type it again"
              className="bg-background"
              autoComplete="new-password"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 rounded-md border border-emerald/30 bg-emerald/10 px-3 py-2 text-xs text-emerald">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleChangePassword}
            disabled={saving || pw1.length === 0 || pw2.length === 0}
            className="gap-1.5"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? "Updating..." : "Update password"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- Danger Zone (delete account) ----------

function DangerZoneCard() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setError(null)
    setDeleting(true)
    try {
      const res = await fetch("/api/account/delete", { method: "POST" })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      // Best-effort client sign-out so we don't keep a stale cookie.
      const supabase = createSupabaseBrowser()
      await supabase.auth.signOut().catch(() => {})
      router.replace("/")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setDeleting(false)
    }
  }

  return (
    <Card className="border-danger/30 bg-danger/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-danger">
          <AlertTriangle className="size-4" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Deleting your account permanently removes your analyses, generated
          listings, tracked gigs, and snapshots. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-danger/20 bg-background/40 p-3 text-xs text-muted-foreground">
          If you have an active Pro subscription, cancel it from the
          Subscription card above first so you&apos;re not billed again.
          Flutterwave subscriptions are not auto-cancelled on account deletion.
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
            onClick={() => {
              setOpen(true)
              setConfirm("")
              setError(null)
            }}
          >
            <Trash2 className="size-3.5" />
            Delete my account
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-danger">
              <AlertTriangle className="size-4" />
              Delete account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action is irreversible. All of your data — analyses,
              generated gigs, tracked competitors, history — will be wiped from
              our servers immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm" className="text-xs">
              Type <span className="font-mono text-danger">DELETE</span> to
              confirm
            </Label>
            <Input
              id="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              className="bg-background"
              autoFocus
            />
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || confirm !== "DELETE"}
              onClick={(e) => {
                // Don't auto-close — we close manually after the network call.
                e.preventDefault()
                void handleDelete()
              }}
              className="gap-1.5 bg-danger text-white hover:bg-danger/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <LogOut className="size-3.5" />
                  Delete account
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------- Notifications ----------

/**
 * Email-notifications toggle. UI-only for now: the in-app activity feed
 * is the source of truth and `lib/email.ts` is a no-op. Persisted to
 * localStorage so the choice survives reloads; wire the toggle to your
 * actual provider preferences once you swap the email stub for a real
 * implementation.
 */
function NotificationsCard() {
  const STORAGE_KEY = "jobflow:email-notifications"
  const [emailEnabled, setEmailEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw == null ? true : raw === "1"
  })

  const handleChange = (next: boolean) => {
    setEmailEnabled(next)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4 text-emerald" />
          Notifications
        </CardTitle>
        <CardDescription>
          Tracker changes (price drops, rank shifts, edits to competitor
          gigs) always show up in the in-app activity bell. Opt-in to
          mirror them to your email inbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-background/40 p-3">
          <div className="space-y-0.5">
            <Label htmlFor="email-notifications" className="text-sm">
              Email me when a tracked gig or rank changes
            </Label>
            <p className="text-xs text-muted-foreground">
              Sends at most one digest per refresh cycle. You can turn this
              off any time.
            </p>
          </div>
          <Switch
            id="email-notifications"
            checked={emailEnabled}
            onCheckedChange={handleChange}
          />
        </div>
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          <span className="font-medium text-amber-100">Heads up</span> —
          email delivery is currently disabled at the platform level. We&apos;ll
          start honoring this toggle as soon as our transactional email
          provider is enabled.
        </div>
      </CardContent>
    </Card>
  )
}
