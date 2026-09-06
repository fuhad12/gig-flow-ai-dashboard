"use client"

/**
 * Onboarding banner shown above the landing hero for first-time users.
 *
 * Dismissal is sticky (localStorage). We also hide it automatically once
 * the user has burned their first AI credit (`creditsUsed > 0`) — at that
 * point the UI itself is the tutorial and the banner just adds noise.
 */

import { useEffect, useState } from "react"
import { Briefcase, Search, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"

const STORAGE_KEY = "jobflow.welcomeBanner.dismissed.v1"

export interface WelcomeBannerProps {
  /** Used to auto-hide once the user has clearly passed onboarding. */
  creditsUsed: number
}

const STEPS = [
  {
    icon: Search,
    title: "Audit a Fiverr gig",
    body: "Paste any public Fiverr link — yours or a competitor's.",
  },
  {
    icon: Briefcase,
    title: "Write an Upwork proposal",
    body: "Paste a job post under Upwork in the sidebar.",
  },
  {
    icon: Sparkles,
    title: "Ship the rewrite",
    body: "Copy optimized Fiverr copy or send the proposal.",
  },
]

export function WelcomeBanner({ creditsUsed }: WelcomeBannerProps) {
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(true)

  // Read localStorage on mount only — keeps SSR happy and avoids hydration
  // mismatches.
  useEffect(() => {
    setMounted(true)
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "1")
    } catch {
      setDismissed(false)
    }
  }, [])

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(STORAGE_KEY, "1")
    } catch {
      // Some privacy modes block storage — fine, banner just won't stick.
    }
  }

  if (!mounted || dismissed || creditsUsed > 0) return null

  return (
    <div className="relative mb-8 overflow-hidden rounded-xl border border-emerald/30 bg-gradient-to-br from-emerald/10 via-emerald/5 to-transparent px-5 py-5">
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-2 top-2 size-7 text-muted-foreground hover:text-foreground"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </Button>
      <div className="flex items-center gap-2 text-emerald">
        <Sparkles className="size-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">
          Welcome to JobFlow AI
        </span>
      </div>
      <h2 className="mt-1 text-lg font-semibold text-foreground">
        Rank on Fiverr. Win on Upwork.
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, idx) => (
          <div
            key={step.title}
            className="rounded-lg border border-border/60 bg-card/60 p-3"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-emerald/15 text-emerald">
                <step.icon className="size-3.5" />
              </div>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Step {idx + 1}
              </span>
            </div>
            <div className="text-sm font-medium text-foreground">
              {step.title}
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {step.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
