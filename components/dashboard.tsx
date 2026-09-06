"use client"

import { useState, useCallback, useEffect } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { NotificationsBell } from "@/components/notifications-bell"
import { LandingView } from "@/components/landing-view"
import { AuditorView } from "@/components/auditor-view"
import { TrendsView } from "@/components/trends-view"
import { HistoryView } from "@/components/history-view"
import { GeneratorView } from "@/components/generator-view"
import { PredictView } from "@/components/predict-view"
import { ProposalView } from "@/components/proposal-view"
import { ProfileOptimizerView } from "@/components/profile-optimizer-view"
import { TrackingView } from "@/components/tracking-view"
import { TrackingDetailView } from "@/components/tracking-detail-view"
import { CompareView } from "@/components/compare-view"
import { SosRecoveryView } from "@/components/sos-recovery-view"
import { SettingsView } from "@/components/settings-view"
import { PaywallModal } from "@/components/paywall-modal"
import { getNicheDisplayName } from "@/lib/niches"
import { buildSkillsFromTags } from "@/lib/profile-optimizer-types"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  HelpCircle,
  Mail,
  MessageSquare,
  FileText,
  Menu,
  BarChart3,
} from "lucide-react"

import type { AnalyzeResponse } from "@/lib/analysis-types"

type View =
  | "landing"
  | "auditor"
  | "history"
  | "trends"
  | "generator"
  | "predict"
  | "proposal"
  | "profile"
  | "tracker"
  | "tracker-detail"
  | "compare"
  | "recover"
  | "help"
  | "settings"

type SubscriptionPlanLabel =
  | "pro-monthly"
  | "pro-yearly"
  | "agency-monthly"
  | "agency-yearly"

interface DashboardProps {
  user: { id: string; email: string }
  // NOTE: `creditsUsed` is the unified monthly "AI credit" counter — each
  // analyze OR generate consumes one credit drawn from the user's monthly
  // pool first, then their top-up balance. See lib/quota.ts.
  isPremium: boolean
  tier: "free" | "pro" | "agency"
  subscriptionPlan: SubscriptionPlanLabel | null
  subscriptionStatus: string | null
  initialTopupBalance: number
  /**
   * Niche slugs the user pinned in Settings, in priority order. The first
   * element is treated as the "primary" niche (default for the generator,
   * the trends dropdown, and AI prompt context).
   */
  selectedNiches: string[]
  /**
   * Chip-style skill tags the user chose in Settings. Threaded into the
   * generator as a default (joined into a placeholder sentence so the
   * user has something concrete to edit).
   */
  skillTags: string[]
  currentPeriodEnd: string | null
  initialCreditsUsed: number
  creditLimit: number
  /**
   * True when the user has never saved or dismissed the niche-selection
   * step (server-side: `profiles.onboarded_at IS NULL`). When true we
   * auto-land them on the Settings view with a prominent welcome banner
   * pointing at the niches card, so the first thing they do after signin
   * is configure their profile rather than poke at an empty dashboard.
   */
  needsNicheOnboarding: boolean
}

function HelpView() {
  const helpItems = [
    { icon: FileText, title: "Documentation", description: "Learn how to get the most out of JobFlow AI" },
    { icon: MessageSquare, title: "Community", description: "Join our Discord community of 2,000+ sellers" },
    { icon: Mail, title: "Contact Support", description: "Get help from our team within 24 hours" },
  ]

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 sm:p-6">
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2 sm:text-2xl">
          <HelpCircle className="size-5 text-emerald sm:size-6" />
          Help & Support
        </h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          Help with Fiverr ranking audits and Upwork proposals
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {helpItems.map((item) => (
          <Card key={item.title} className="border-border bg-card hover:border-emerald/50 transition-colors cursor-pointer">
            <CardHeader>
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald/10 mb-2">
                <item.icon className="size-5 text-emerald" />
              </div>
              <CardTitle className="text-foreground">{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function Dashboard({
  user,
  isPremium,
  tier,
  subscriptionPlan,
  subscriptionStatus,
  currentPeriodEnd,
  initialCreditsUsed,
  creditLimit,
  initialTopupBalance,
  selectedNiches,
  skillTags,
  needsNicheOnboarding,
}: DashboardProps) {
  // The user's primary niche slug, if any. Empty string falls through to
  // each consumer's existing default behavior.
  const primaryNicheSlug = selectedNiches[0] ?? ""
  // The user's primary skill tag. The generator's "Skill" field is a
  // longer-form sentence ("Build production-ready Next.js SaaS apps…"),
  // so we use the primary tag only as a seed phrase — the user will
  // expand it. Joining all tags would be too noisy for that field.
  const primarySkillTag = skillTags[0] ?? null
  // First-run gate: drop the user straight on Settings (where the niches
  // card lives) instead of the marketing-style landing view. We only flip
  // the default — they can still navigate freely once they're here.
  const [currentView, setCurrentView] = useState<View>(
    needsNicheOnboarding ? "settings" : "landing",
  )
  // Local mirror of the server flag. Stays true until the user either
  // saves niches or explicitly dismisses the welcome banner, at which
  // point the NichesCard/banner fire `onOnboardingComplete` and we flip
  // this off so the banner disappears without a page reload.
  const [showOnboardingBanner, setShowOnboardingBanner] = useState(
    needsNicheOnboarding,
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)
  const [creditsUsed, setCreditsUsed] = useState(initialCreditsUsed)
  const [topupBalance, setTopupBalance] = useState(initialTopupBalance)
  // Tracks the modal mode separately from "is it open" so we can open it
  // pre-selected to the topups tab when the user just hit their cap.
  const [paywallMode, setPaywallMode] = useState<"tiers" | "topups">("tiers")
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  // Tracks whether the auditor was opened from the landing flow or from a
  // history row, so the Back button returns to the right place.
  const [auditorReturnTo, setAuditorReturnTo] = useState<View>("landing")
  // Optional niche slug from Trends "Generate gig in this niche" CTA.
  const [generatorNiche, setGeneratorNiche] = useState<string | undefined>(
    undefined,
  )
  // Optional pre-filled skill phrase (from the keyword-discovery card).
  const [generatorSkill, setGeneratorSkill] = useState<string | undefined>(
    undefined,
  )
  // Currently inspected tracked gig id (drives the tracker detail view).
  const [trackedGigId, setTrackedGigId] = useState<string | null>(null)

  // First-touch referral: if jf_ref cookie is set, persist onto profile once.
  useEffect(() => {
    void fetch("/api/referral/attribute", { method: "POST" }).catch(() => {
      // Non-blocking — cookie may be absent or already attributed.
    })
  }, [])

  // Open the paywall pre-selected to whichever tab makes sense given the
  // user's state. Defaults to "topups" when both monthly AND topup pools
  // are empty — that's the fastest unblock for a paying user.
  const openPaywall = useCallback(
    (mode: "tiers" | "topups" = "tiers") => {
      setPaywallMode(mode)
      setShowPaywall(true)
    },
    [],
  )

  // The live remaining counter the dashboard gates on. Mirrors the server's
  // `monthlyRemaining + topupBalance` calculation, just from local state.
  const monthlyRemaining = Math.max(0, creditLimit - creditsUsed)
  const totalRemaining = monthlyRemaining + topupBalance

  const handleAnalyzeStart = useCallback(() => {
    if (totalRemaining <= 0) {
      openPaywall(isPremium ? "topups" : "tiers")
      return false
    }
    return true
  }, [totalRemaining, isPremium, openPaywall])

  // Mirrors `chargeCredit` in lib/quota.ts: if monthly still had room, the
  // server billed monthly — bump `creditsUsed` only. Otherwise the server
  // decremented a topup row — bump `creditsUsed` AND drop `topupBalance`.
  const bumpCreditCounter = useCallback(() => {
    setCreditsUsed((prevUsed) => {
      const next = prevUsed + 1
      if (next > creditLimit) {
        setTopupBalance((prevTopup) => Math.max(0, prevTopup - 1))
      }
      return next
    })
  }, [creditLimit])

  const handleAnalyzeComplete = useCallback(
    (result: AnalyzeResponse) => {
      setAnalysis(result)
      setAuditorReturnTo("landing")
      setCurrentView("auditor")
      bumpCreditCounter()
    },
    [bumpCreditCounter],
  )

  // Generator / predictor call this after a successful (non-cached) call.
  // The server is the source of truth; this just keeps the live dashboard
  // counter from going stale until the next page reload.
  const handleCreditUsed = useCallback(() => {
    bumpCreditCounter()
  }, [bumpCreditCounter])

  const handleOpenHistoryItem = useCallback((item: AnalyzeResponse) => {
    setAnalysis(item)
    setAuditorReturnTo("history")
    setCurrentView("auditor")
  }, [])

  const handleGenerateForNiche = useCallback((slug: string) => {
    setGeneratorNiche(slug)
    setGeneratorSkill(undefined)
    setCurrentView("generator")
  }, [])

  const handleGenerateWithKeyword = useCallback(
    (slug: string, skill: string) => {
      setGeneratorNiche(slug)
      setGeneratorSkill(skill)
      setCurrentView("generator")
    },
    [],
  )

  const handleOpenTrackedGig = useCallback((id: string) => {
    setTrackedGigId(id)
    setCurrentView("tracker-detail")
  }, [])

  const handleCloseTrackedGig = useCallback(() => {
    setTrackedGigId(null)
    setCurrentView("tracker")
  }, [])

  const handleBack = useCallback(() => {
    setCurrentView(auditorReturnTo)
  }, [auditorReturnTo])

  const renderView = () => {
    switch (currentView) {
      case "landing":
        return (
          <LandingView
            onAnalyzeStart={handleAnalyzeStart}
            onAnalyzeComplete={handleAnalyzeComplete}
            creditsUsed={creditsUsed}
            creditLimit={creditLimit}
            topupBalance={topupBalance}
            isPremiumUser={isPremium}
          />
        )
      case "auditor":
        return analysis ? (
          <AuditorView onBack={handleBack} data={analysis} />
        ) : (
          <LandingView
            onAnalyzeStart={handleAnalyzeStart}
            onAnalyzeComplete={handleAnalyzeComplete}
            creditsUsed={creditsUsed}
            creditLimit={creditLimit}
            topupBalance={topupBalance}
            isPremiumUser={isPremium}
          />
        )
      case "history":
        return (
          <HistoryView
            onOpenItem={handleOpenHistoryItem}
            onAnalyze={() => setCurrentView("landing")}
          />
        )
      case "trends":
        return (
          <TrendsView
            onGenerateInNiche={handleGenerateForNiche}
            onGenerateWithKeyword={handleGenerateWithKeyword}
            // Trends actions that trigger Firecrawl scrapes or LLM
            // insights return 402 when the user is out of monthly AI
            // credits. Pop the same paywall the analyzer / generator use.
            onQuotaExceeded={() => openPaywall(isPremium ? "topups" : "tiers")}
            // CTA on the "cached trends — upgrade to refresh" banner.
            // Routes to topups for Pro users out of credits and to the
            // tier picker for free users.
            onUpgrade={() => openPaywall(isPremium ? "topups" : "tiers")}
            // CTA on the "pin this niche" empty state. Routes to the
            // Settings view so the user can actually pin the niche —
            // earlier this was wired to onUpgrade by mistake and opened
            // the paywall instead.
            onOpenSettings={() => setCurrentView("settings")}
            isPremium={isPremium}
          />
        )
      case "generator":
        return (
          <GeneratorView
            // Same client-side credit pre-check the analyzer uses — opens
            // the paywall immediately when the user is out of credits
            // instead of waiting for the server's 402 after the LLM call.
            onGenerateStart={handleAnalyzeStart}
            onQuotaExceeded={() => openPaywall(isPremium ? "topups" : "tiers")}
            onCreditUsed={handleCreditUsed}
            // generator's explicit override (from the "Generate gig in this
            // niche" CTA) takes priority over the user's pinned primary.
            initialNiche={generatorNiche ?? (primaryNicheSlug || undefined)}
            initialSkill={
              generatorSkill ||
              buildSkillsFromTags(skillTags) ||
              primarySkillTag ||
              undefined
            }
            initialTools={
              skillTags.length > 0 ? skillTags.join(", ") : undefined
            }
            userNiches={selectedNiches}
          />
        )
      case "predict":
        return (
          <PredictView
            onPredictStart={handleAnalyzeStart}
            onQuotaExceeded={() => openPaywall(isPremium ? "topups" : "tiers")}
            onCreditUsed={handleCreditUsed}
          />
        )
      case "proposal": {
        const nicheLabel =
          generatorNiche || primaryNicheSlug
            ? getNicheDisplayName(generatorNiche || primaryNicheSlug)
            : ""
        const skillsLabel =
          generatorSkill ||
          buildSkillsFromTags(skillTags) ||
          primarySkillTag ||
          ""
        const toolsLabel = skillTags.join(", ")
        const hasProfile = Boolean(nicheLabel || skillsLabel || toolsLabel)
        return (
          <ProposalView
            defaultNiche={nicheLabel}
            defaultSkills={skillsLabel}
            defaultTools={toolsLabel}
            fromProfile={hasProfile}
            onCreditStart={handleAnalyzeStart}
            onCreditUsed={handleCreditUsed}
            onUpgrade={() => openPaywall(isPremium ? "topups" : "tiers")}
          />
        )
      }
      case "profile":
        return (
          <ProfileOptimizerView
            onCreditStart={handleAnalyzeStart}
            onCreditUsed={handleCreditUsed}
            onUpgrade={() => openPaywall(isPremium ? "topups" : "tiers")}
          />
        )
      case "tracker":
        return <TrackingView onOpenGig={handleOpenTrackedGig} />
      case "tracker-detail":
        return trackedGigId ? (
          <TrackingDetailView
            trackedGigId={trackedGigId}
            onBack={handleCloseTrackedGig}
          />
        ) : (
          <TrackingView onOpenGig={handleOpenTrackedGig} />
        )
      case "compare":
        return (
          <CompareView
            isPremium={isPremium}
            onUpgrade={() => openPaywall("tiers")}
          />
        )
      case "recover":
        return <SosRecoveryView />
      case "help":
        return <HelpView />
      case "settings":
        return (
          <SettingsView
            user={user}
            isPremium={isPremium}
            tier={tier}
            subscriptionPlan={subscriptionPlan}
            subscriptionStatus={subscriptionStatus}
            currentPeriodEnd={currentPeriodEnd}
            creditsUsed={creditsUsed}
            creditLimit={creditLimit}
            topupBalance={topupBalance}
            onUpgrade={() => openPaywall("tiers")}
            onBuyCredits={() => openPaywall("topups")}
            initialSelectedNiches={selectedNiches}
            initialSkillTags={skillTags}
            showOnboardingBanner={showOnboardingBanner}
            onOnboardingComplete={() => setShowOnboardingBanner(false)}
          />
        )
      default:
        return (
          <LandingView
            onAnalyzeStart={handleAnalyzeStart}
            onAnalyzeComplete={handleAnalyzeComplete}
            creditsUsed={creditsUsed}
            creditLimit={creditLimit}
            topupBalance={topupBalance}
            isPremiumUser={isPremium}
          />
        )
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        user={user}
        isPremium={isPremium}
        mobileOpen={mobileNavOpen}
        onMobileOpenChange={setMobileNavOpen}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile topbar — visible only under md. Desktop uses the
            persistent sidebar; the bell still sits in the top-right
            via the floating slot below. */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 backdrop-blur md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="text-foreground"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald text-primary-foreground">
              <BarChart3 className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              JobFlow AI
            </span>
          </div>
          <NotificationsBell onOpenTrackedGig={handleOpenTrackedGig} />
        </header>
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          {/* Floating bell — only on desktop (mobile uses the topbar one). */}
          <div className="pointer-events-none absolute right-3 top-3 z-30 hidden md:block">
            <div className="pointer-events-auto">
              <NotificationsBell onOpenTrackedGig={handleOpenTrackedGig} />
            </div>
          </div>
          {renderView()}
        </main>
      </div>
      <PaywallModal
        open={showPaywall}
        onOpenChange={setShowPaywall}
        defaultMode={paywallMode}
      />
    </div>
  )
}
