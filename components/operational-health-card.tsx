"use client"

/**
 * Account-level ranking health checklist.
 *
 * Self-reported Fiverr analytics signals (no public API). Values persist
 * in localStorage so advice stays tailored across sessions.
 */

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PackageCheck,
  ShieldCheck,
  TrendingDown,
  Wifi,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Severity = "good" | "warn" | "bad"

interface SignalState {
  responseHours: number | null
  completionPct: number | null
  onTimePct: number | null
  daysOnline: number | null
}

const STORAGE_KEY = "jobflow.accountHealth.v1"

const EMPTY: SignalState = {
  responseHours: null,
  completionPct: null,
  onTimePct: null,
  daysOnline: null,
}

function gradeResponse(h: number | null): Severity {
  if (h == null || !Number.isFinite(h)) return "warn"
  if (h < 1) return "good"
  if (h <= 4) return "warn"
  return "bad"
}
function gradeCompletion(p: number | null): Severity {
  if (p == null || !Number.isFinite(p)) return "warn"
  if (p >= 95) return "good"
  if (p >= 90) return "warn"
  return "bad"
}
function gradeOnTime(p: number | null): Severity {
  if (p == null || !Number.isFinite(p)) return "warn"
  if (p >= 95) return "good"
  if (p >= 90) return "warn"
  return "bad"
}
function gradeOnline(d: number | null): Severity {
  if (d == null || !Number.isFinite(d)) return "warn"
  if (d >= 6) return "good"
  if (d >= 4) return "warn"
  return "bad"
}

function loadStored(): SignalState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SignalState>
    return {
      responseHours:
        parsed.responseHours == null ? null : Number(parsed.responseHours),
      completionPct:
        parsed.completionPct == null ? null : Number(parsed.completionPct),
      onTimePct: parsed.onTimePct == null ? null : Number(parsed.onTimePct),
      daysOnline: parsed.daysOnline == null ? null : Number(parsed.daysOnline),
    }
  } catch {
    return null
  }
}

function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(100, Math.max(0, n))
}

export function OperationalHealthCard() {
  const [s, setS] = useState<SignalState>(EMPTY)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const stored = loadStored()
    if (stored) setS(stored)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const hasAny =
      s.responseHours != null ||
      s.completionPct != null ||
      s.onTimePct != null ||
      s.daysOnline != null
    if (!hasAny) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch {
      // ignore
    }
  }, [s, hydrated])

  const signals = useMemo(
    () => [
      {
        key: "response" as const,
        label: "Response time",
        severity: gradeResponse(s.responseHours),
        threshold:
          "Target: < 1 hr. Under-1-hour responders get a meaningful ranking boost; over 4 hours is the biggest individual penalty.",
      },
      {
        key: "completion" as const,
        label: "Order completion rate",
        severity: gradeCompletion(s.completionPct),
        threshold:
          "Target: ≥ 95%. Cancellations destroy ranking — deliver and revise rather than cancel.",
      },
      {
        key: "ontime" as const,
        label: "On-time delivery",
        severity: gradeOnTime(s.onTimePct),
        threshold:
          "Target: ≥ 95%. Late deliveries hurt ranking for up to 60 days.",
      },
      {
        key: "online" as const,
        label: "Days online in the last 7",
        severity: gradeOnline(s.daysOnline),
        threshold:
          "Target: 6-7 of 7. Extended inactivity slows the algorithm pushing your gigs.",
      },
    ],
    [s],
  )

  const hasAnyValue =
    s.responseHours != null ||
    s.completionPct != null ||
    s.onTimePct != null ||
    s.daysOnline != null

  const worstSignal = useMemo(() => {
    if (!hasAnyValue) return null
    const bad = signals.find((sig) => sig.severity === "bad")
    if (bad) return bad
    return signals.find((sig) => sig.severity === "warn") ?? null
  }, [signals, hasAnyValue])

  const allGood =
    hasAnyValue &&
    signals.every((sig) => {
      const val =
        sig.key === "response"
          ? s.responseHours
          : sig.key === "completion"
            ? s.completionPct
            : sig.key === "ontime"
              ? s.onTimePct
              : s.daysOnline
      return val != null && sig.severity === "good"
    })

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="size-4 text-emerald" />
          Account-level ranking health
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Enter your real Fiverr Analytics numbers — these are not defaults.
          They apply to every gig on your account.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnyValue && hydrated && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
            <p>
              Empty on purpose. Paste values from{" "}
              <span className="font-medium text-foreground/80">
                Fiverr → Selling → Analytics
              </span>{" "}
              so JobFlow can flag your biggest ranking leak.
            </p>
          </div>
        )}

        {worstSignal && (
          <div
            className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
              worstSignal.severity === "bad"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            }`}
          >
            {worstSignal.severity === "bad" ? (
              <TrendingDown className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            )}
            <div>
              <p className="font-semibold">
                Biggest leak right now:{" "}
                <span className="underline">{worstSignal.label}</span>
              </p>
              <p className="mt-1 opacity-90">{worstSignal.threshold}</p>
            </div>
          </div>
        )}

        {allGood && (
          <div className="flex items-start gap-2 rounded-md border border-emerald/30 bg-emerald/5 p-3 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald" />
            <p>
              All four signals look healthy. Keep these green and the algorithm
              will reward you across every gig you publish.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SignalInput
            label="Response time (hours)"
            icon={<Clock className="size-3.5" />}
            severity={gradeResponse(s.responseHours)}
            input={
              <Input
                type="number"
                min={0}
                step={0.5}
                placeholder="e.g. 0.5"
                value={s.responseHours ?? ""}
                onChange={(e) =>
                  setS((p) => ({
                    ...p,
                    responseHours:
                      e.target.value === ""
                        ? null
                        : Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="h-8 text-sm"
              />
            }
            hint="Target < 1"
          />
          <SignalInput
            label="Order completion %"
            icon={<PackageCheck className="size-3.5" />}
            severity={gradeCompletion(s.completionPct)}
            input={
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="e.g. 98"
                value={s.completionPct ?? ""}
                onChange={(e) =>
                  setS((p) => ({
                    ...p,
                    completionPct:
                      e.target.value === ""
                        ? null
                        : clampPct(Number(e.target.value)),
                  }))
                }
                className="h-8 text-sm"
              />
            }
            hint="Target ≥ 95"
          />
          <SignalInput
            label="On-time delivery %"
            icon={<ShieldCheck className="size-3.5" />}
            severity={gradeOnTime(s.onTimePct)}
            input={
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="e.g. 97"
                value={s.onTimePct ?? ""}
                onChange={(e) =>
                  setS((p) => ({
                    ...p,
                    onTimePct:
                      e.target.value === ""
                        ? null
                        : clampPct(Number(e.target.value)),
                  }))
                }
                className="h-8 text-sm"
              />
            }
            hint="Target ≥ 95"
          />
          <SignalInput
            label="Days online (last 7)"
            icon={<Wifi className="size-3.5" />}
            severity={gradeOnline(s.daysOnline)}
            input={
              <Select
                value={
                  s.daysOnline == null ? undefined : String(s.daysOnline)
                }
                onValueChange={(v) =>
                  setS((p) => ({ ...p, daysOnline: Number(v) }))
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 8 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {i} / 7
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            hint="Target 6-7"
          />
        </div>

        <p className="text-[10px] text-muted-foreground">
          Find these in{" "}
          <span className="font-medium">Fiverr → Selling → Analytics</span>.
          Values are stored locally on this device — they help JobFlow tailor
          advice but aren&apos;t sent to your account.
        </p>
      </CardContent>
    </Card>
  )
}

interface SignalInputProps {
  label: string
  icon: React.ReactNode
  severity: Severity
  input: React.ReactNode
  hint: string
}

function SignalInput({ label, icon, severity, input, hint }: SignalInputProps) {
  const toneRing =
    severity === "bad"
      ? "border-danger/30"
      : severity === "warn"
        ? "border-amber-500/30"
        : "border-emerald/30"

  return (
    <div className={`space-y-1 rounded-md border ${toneRing} p-2`}>
      <Label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
        <span className="ml-auto text-[10px] opacity-70">{hint}</span>
      </Label>
      {input}
    </div>
  )
}
