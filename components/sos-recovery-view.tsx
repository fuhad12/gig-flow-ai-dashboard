"use client"

/**
 * SOS recovery view — for the user whose gig de-ranked after they
 * edited it on Fiverr (the literal scenario that prompted this whole
 * P1-P8 sweep).
 *
 * The 2026 Fiverr algorithm runs a 7-28 day re-evaluation window
 * after any live-gig edit. During that window, impressions typically
 * drop by 30-70% before partially or fully recovering. Sellers who
 * panic and keep editing during the window re-start the cycle and
 * end up trapped indefinitely.
 *
 * This view does three things:
 *   1. Anchors when the edit happened (user-supplied date).
 *   2. Shows a live countdown to the 28-day re-evaluation horizon.
 *   3. Surfaces a milestone-by-milestone checklist of what to do
 *      (and crucially, what NOT to do) at each stage of the window.
 *
 * The edit date persists in localStorage so the timer survives page
 * reloads. There is no server schema impact — this is intentionally
 * client-only for the first iteration.
 */

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  HelpCircle,
  LifeBuoy,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const STORAGE_KEY = "jobflow.sosRecovery.editIso"
const EVALUATION_WINDOW_DAYS = 28

interface Milestone {
  day: number
  title: string
  doList: string[]
  dontList: string[]
}

const MILESTONES: Milestone[] = [
  {
    day: 0,
    title: "Days 1-3 · The drop",
    doList: [
      "Expect a sharp impressions drop — this is the algorithm re-indexing your gig, not a verdict on the change.",
      "Note your baseline (impressions / clicks / orders) the day before the edit so you have a true comparison later.",
      "Stay online and responsive to keep your account-level signals healthy.",
    ],
    dontList: [
      "DO NOT make another edit. Every additional edit resets the re-evaluation clock to day 0.",
      "DO NOT panic-lower your prices — Fiverr penalises sudden price drops as a 'desperation' signal.",
      "DO NOT add or remove tags. Tags are the highest-impact field and the most-watched.",
    ],
  },
  {
    day: 4,
    title: "Days 4-7 · Stabilisation",
    doList: [
      "Drive your own traffic — share the gig link on LinkedIn, X, Reddit, niche communities. External traffic with conversions is the fastest recovery lever.",
      "Send order updates and respond to messages within an hour to push the operational signals up.",
      "If a buyer reaches out, prioritise converting them — even one cheap order during the window dramatically boosts re-ranking.",
    ],
    dontList: [
      "DO NOT touch the gig fields. Wait.",
      "DO NOT cancel any orders, even problematic ones. Use revisions or partial refunds instead.",
    ],
  },
  {
    day: 8,
    title: "Days 8-14 · The first signal",
    doList: [
      "Compare impressions to days 1-3. If they're climbing, the edit is helping — stay the course.",
      "If impressions are still 30%+ below baseline, the edit likely hurt and you'll plan a reversal AFTER the 28-day window closes.",
      "Continue external traffic + fast responses.",
    ],
    dontList: [
      "DO NOT edit yet, even if the trend looks bad. The window isn't over.",
      "DO NOT request feedback from existing clients in bulk — Fiverr flags coordinated review activity.",
    ],
  },
  {
    day: 15,
    title: "Days 15-21 · Mid-window",
    doList: [
      "Read 7-day rolling averages, never daily numbers. Daily numbers are noise.",
      "Check Fiverr Forum or seller groups for confirmation that other sellers in your category are recovering too — sometimes the issue is category-wide, not your gig.",
    ],
    dontList: [
      "DO NOT add new gigs to your account during the window. New gigs compete for the same internal credit and slow recovery.",
    ],
  },
  {
    day: 22,
    title: "Days 22-28 · Decision time",
    doList: [
      "Pull the final 7-day numbers. If impressions/CTR have recovered to ≥ 80% of baseline, the edit was good. Keep it.",
      "If still suppressed, plan exactly ONE single-field reversal for day 29+. Pick the field with the most aggressive change (usually the title) and revert it.",
    ],
    dontList: [
      "DO NOT make multiple field changes after this window. Same rule, fresh 28-day clock.",
    ],
  },
]

function readStoredEditDate(): string {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(STORAGE_KEY) ?? ""
}

function persistEditDate(iso: string) {
  if (typeof window === "undefined") return
  if (iso) {
    window.localStorage.setItem(STORAGE_KEY, iso)
  } else {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

function todayIsoDate(): string {
  const d = new Date()
  // Use the local date in YYYY-MM-DD to keep it in lockstep with the
  // <input type="date"> picker.
  const yyyy = d.getFullYear().toString().padStart(4, "0")
  const mm = (d.getMonth() + 1).toString().padStart(2, "0")
  const dd = d.getDate().toString().padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const a = new Date(fromIsoDate + "T00:00:00")
  const b = new Date(toIsoDate + "T00:00:00")
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

export function SosRecoveryView() {
  const [editDate, setEditDate] = useState<string>("")
  const [draftDate, setDraftDate] = useState<string>(todayIsoDate())

  useEffect(() => {
    const stored = readStoredEditDate()
    if (stored) {
      setEditDate(stored)
      setDraftDate(stored)
    }
  }, [])

  const daysSinceEdit = useMemo(() => {
    if (!editDate) return null
    return Math.max(0, daysBetween(editDate, todayIsoDate()))
  }, [editDate])

  const daysRemaining = useMemo(() => {
    if (daysSinceEdit === null) return null
    return Math.max(0, EVALUATION_WINDOW_DAYS - daysSinceEdit)
  }, [daysSinceEdit])

  const percentComplete = useMemo(() => {
    if (daysSinceEdit === null) return 0
    return Math.min(100, (daysSinceEdit / EVALUATION_WINDOW_DAYS) * 100)
  }, [daysSinceEdit])

  const currentMilestone = useMemo<Milestone | null>(() => {
    if (daysSinceEdit === null) return null
    // Pick the highest milestone whose day floor is <= daysSinceEdit.
    return [...MILESTONES].reverse().find((m) => daysSinceEdit >= m.day) ?? MILESTONES[0]
  }, [daysSinceEdit])

  const handleStart = () => {
    if (!draftDate) return
    persistEditDate(draftDate)
    setEditDate(draftDate)
  }

  const handleReset = () => {
    persistEditDate("")
    setEditDate("")
    setDraftDate(todayIsoDate())
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground sm:text-2xl">
          <LifeBuoy className="size-5 text-emerald" />
          Recovery — your gig just de-ranked
        </h1>
        <p className="text-sm text-muted-foreground">
          If your Fiverr gig dropped impressions after a recent edit, you&apos;re
          inside Fiverr&apos;s 7-28 day re-evaluation window. This page walks you
          through it so you don&apos;t make the situation worse by editing
          again — which is, statistically, what most sellers do.
        </p>
      </div>

      {!editDate && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="size-4 text-emerald" />
              When did you edit the gig?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We anchor the 28-day re-evaluation clock to that date.
              Don&apos;t worry about being exact — within 1-2 days is fine.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5 sm:flex-1">
                <Label htmlFor="sos-edit-date" className="text-xs">
                  Edit date
                </Label>
                <Input
                  id="sos-edit-date"
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  max={todayIsoDate()}
                />
              </div>
              <Button
                onClick={handleStart}
                disabled={!draftDate}
                className="sm:w-auto"
              >
                Start the recovery clock
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {editDate && daysSinceEdit !== null && daysRemaining !== null && (
        <>
          <CountdownCard
            daysSinceEdit={daysSinceEdit}
            daysRemaining={daysRemaining}
            percentComplete={percentComplete}
            editDate={editDate}
            onReset={handleReset}
          />

          {currentMilestone && <MilestoneCard milestone={currentMilestone} />}

          <UniversalRulesCard />

          <FutureMilestonesCard currentDay={daysSinceEdit} />
        </>
      )}
    </div>
  )
}

interface CountdownCardProps {
  daysSinceEdit: number
  daysRemaining: number
  percentComplete: number
  editDate: string
  onReset: () => void
}

function CountdownCard({
  daysSinceEdit,
  daysRemaining,
  percentComplete,
  editDate,
  onReset,
}: CountdownCardProps) {
  const done = daysRemaining === 0
  return (
    <Card
      className={
        done
          ? "border-emerald/40 bg-emerald/5"
          : "border-amber-500/30 bg-amber-500/5"
      }
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Clock
              className={
                done ? "size-4 text-emerald" : "size-4 text-amber-500"
              }
            />
            {done ? "Re-evaluation window closed" : "Re-evaluation in progress"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <XCircle className="size-3.5" />
            Reset / wrong date
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Days since edit" value={String(daysSinceEdit)} />
          <Stat
            label={done ? "Window closed" : "Days remaining"}
            value={done ? "—" : String(daysRemaining)}
            tone={done ? "good" : "neutral"}
          />
          <Stat label="Edited on" value={formatHumanDate(editDate)} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Day 0</span>
            <span>Day {EVALUATION_WINDOW_DAYS}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={
                done
                  ? "h-full bg-emerald transition-all"
                  : "h-full bg-amber-500 transition-all"
              }
              style={{ width: `${percentComplete}%` }}
            />
          </div>
        </div>

        {done && (
          <div className="flex items-start gap-2 rounded-md border border-emerald/30 bg-emerald/10 p-3 text-xs text-emerald">
            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
            <p>
              The 28-day window has closed. Pull your 7-day rolling
              metrics and compare to the baseline. If impressions are
              within 80% of baseline, keep the edit. If still suppressed,
              plan ONE single-field reversal and start a fresh 28-day
              clock.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MilestoneCard({ milestone }: { milestone: Milestone }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4 text-emerald" />
          You&apos;re here: {milestone.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-md border border-emerald/30 bg-emerald/5 p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald">
            <CheckCircle2 className="size-3.5" />
            Do
          </h3>
          <ul className="space-y-1.5 pl-4 text-xs text-muted-foreground [&>li]:list-disc">
            {milestone.doList.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-danger">
            <XCircle className="size-3.5" />
            Do NOT
          </h3>
          <ul className="space-y-1.5 pl-4 text-xs text-muted-foreground [&>li]:list-disc">
            {milestone.dontList.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

function UniversalRulesCard() {
  return (
    <Card className="border-danger/30 bg-danger/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-danger">
          <AlertTriangle className="size-4" />
          Three rules that apply for all 28 days
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 pl-5 text-sm text-foreground [&>li]:list-decimal">
          <li>
            <span className="font-semibold">No more edits.</span> Every
            additional edit resets the 28-day clock to zero. This is the
            single most common mistake.
          </li>
          <li>
            <span className="font-semibold">No price changes.</span>{" "}
            Sudden drops are read as a desperation signal; sudden rises
            tank conversion. Hold price for the full window.
          </li>
          <li>
            <span className="font-semibold">No new gigs.</span> New gigs
            compete for the same internal account credit and slow
            recovery. Hold off until the window closes.
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}

function FutureMilestonesCard({ currentDay }: { currentDay: number }) {
  const upcoming = MILESTONES.filter((m) => m.day > currentDay)
  if (upcoming.length === 0) return null
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          <HelpCircle className="size-4 text-muted-foreground" />
          What&apos;s coming next
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {upcoming.map((m) => (
            <div
              key={m.day}
              className="rounded-md border border-border bg-secondary/40 p-3"
            >
              <p className="text-xs font-semibold text-foreground">
                {m.title}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Starts in {m.day - currentDay} day{m.day - currentDay === 1 ? "" : "s"}.
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "good" | "neutral"
}) {
  return (
    <div className="rounded-md border border-border bg-secondary/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 text-lg font-semibold ${
          tone === "good" ? "text-emerald" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function formatHumanDate(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
