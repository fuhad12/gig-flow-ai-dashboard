"use client"

/**
 * Pre-action warning dialogs for irreversible Fiverr operations.
 *
 * Two variants:
 *   - "cooldown"   → shown before the user copies an audit/optimization
 *                    change to paste into Fiverr. Warns that any live
 *                    edit triggers Fiverr's 7-28 day re-evaluation.
 *   - "title-lock" → shown before the user generates a new gig, because
 *                    Fiverr permanently locks the gig URL to the FIRST
 *                    title saved on a gig (it cannot be changed later).
 *
 * Both ship with two dismissal layers:
 *   - sessionStorage flag — auto-hides the warning after the first
 *     acknowledgment in the same browser session.
 *   - localStorage flag (opt-in via checkbox) — permanently hides the
 *     warning for users who already understand the risk.
 *
 * Callers gate their action behind `shouldShowWarning(variant)`. When
 * `true`, they open the dialog and wire `onConfirm` to the real action.
 * When `false`, they run the action immediately.
 */

import { useState } from "react"
import { AlertTriangle, Clock, Lock } from "lucide-react"

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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export type FiverrWarningVariant = "cooldown" | "title-lock"

interface KeyPair {
  session: string
  forever: string
}

const KEYS: Record<FiverrWarningVariant, KeyPair> = {
  cooldown: {
    session: "jobflow.editCooldownWarning.seenThisSession",
    forever: "jobflow.editCooldownWarning.dismissedForever",
  },
  "title-lock": {
    session: "jobflow.titleLockWarning.seenThisSession",
    forever: "jobflow.titleLockWarning.dismissedForever",
  },
}

export function shouldShowFiverrWarning(variant: FiverrWarningVariant): boolean {
  if (typeof window === "undefined") return false
  const k = KEYS[variant]
  if (window.localStorage.getItem(k.forever) === "1") return false
  if (window.sessionStorage.getItem(k.session) === "1") return false
  return true
}

function markFiverrWarningSeen(
  variant: FiverrWarningVariant,
  forever: boolean,
): void {
  if (typeof window === "undefined") return
  const k = KEYS[variant]
  window.sessionStorage.setItem(k.session, "1")
  if (forever) window.localStorage.setItem(k.forever, "1")
}

interface FiverrWarningDialogProps {
  variant: FiverrWarningVariant
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Action to run when the user clicks the primary CTA. */
  onConfirm: () => void
}

export function FiverrWarningDialog({
  variant,
  open,
  onOpenChange,
  onConfirm,
}: FiverrWarningDialogProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const handleConfirm = () => {
    markFiverrWarningSeen(variant, dontShowAgain)
    onConfirm()
    onOpenChange(false)
  }

  const content =
    variant === "cooldown" ? cooldownContent : titleLockContent

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-warning">
            {variant === "cooldown" ? (
              <Clock className="size-5" />
            ) : (
              <Lock className="size-5" />
            )}
            <AlertDialogTitle>{content.title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>{content.lead}</p>
              <ul className="space-y-1.5 pl-5 [&>li]:list-disc">
                {content.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p className="text-xs">{content.note}</p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-center gap-2">
          <Checkbox
            id={`fiverr-warn-${variant}-skip`}
            checked={dontShowAgain}
            onCheckedChange={(c) => setDontShowAgain(c === true)}
          />
          <Label
            htmlFor={`fiverr-warn-${variant}-skip`}
            className="text-xs text-muted-foreground"
          >
            Don&apos;t show this again
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Wait, let me reconsider</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            {content.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const cooldownContent = {
  title: "Heads up — editing a live gig has a real cost",
  lead: "Pasting this into Fiverr triggers Fiverr's 7-28 day re-evaluation period. Expect a temporary impressions drop — that's normal, not a tool failure. The Fiverr community blog and Help Center both document this.",
  bullets: [
    "Change ONE field at a time. Multiple simultaneous edits make it impossible to tell what helped or hurt.",
    "Don't keep editing during the cooldown — every additional edit re-starts the 28-day evaluation clock.",
    "Read impressions over 7-day windows, not daily — daily numbers are noise.",
    "If you're already ranking, sometimes the best optimisation is doing nothing.",
  ],
  note: "Recovery typically takes 7-14 days. Wait at least 3-4 weeks before deciding whether the change helped or hurt — Fiverr itself recommends this window.",
  confirmLabel: "I understand, copy anyway",
}

const titleLockContent = {
  title: "Lock in the right title — Fiverr can't change the URL later",
  lead: "Once you save this title on Fiverr for the first time, the gig URL is permanently bound to it. You can edit the displayed title later, but the URL keyword is locked forever.",
  bullets: [
    "Pick the title with the keyword you actually want to rank for in the URL.",
    "Make sure the keyword is one buyers really search for — check Fiverr's autocomplete suggestions.",
    "Keep the title under 80 characters so it doesn't truncate in search cards.",
    "Aim for the keyword to appear ONCE near the front, not stuffed.",
  ],
  note: "If you've already saved a gig with a different title, you'll need a brand new gig (not an edit) to get a different URL keyword.",
  confirmLabel: "Title looks good, generate the rest",
}
