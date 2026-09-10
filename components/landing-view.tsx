"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Search,
  Loader2,
  CheckCircle,
  Globe,
  FileText,
  Tag,
  AlertCircle,
} from "lucide-react"

import { WelcomeBanner } from "@/components/welcome-banner"
import type { AnalyzeResponse } from "@/lib/analysis-types"

interface LandingViewProps {
  onAnalyzeStart: () => boolean
  onAnalyzeComplete: (result: AnalyzeResponse) => void
  // Monthly AI credit pool — each analyze OR generate burns one credit.
  creditsUsed: number
  creditLimit: number
  // Top-up balance that rolls forward across months. Added to monthly
  // remaining for the "X credits remaining" display.
  topupBalance: number
  isPremiumUser: boolean
}

const scanSteps = [
  { icon: Globe, label: "Scanning gig metadata...", delay: 0 },
  { icon: FileText, label: "Analyzing title & description...", delay: 800 },
  { icon: Tag, label: "Evaluating keywords & tags...", delay: 1600 },
  { icon: CheckCircle, label: "Generating health score...", delay: 2400 },
]

export function LandingView({
  onAnalyzeStart,
  onAnalyzeComplete,
  creditsUsed,
  creditLimit,
  topupBalance,
  isPremiumUser,
}: LandingViewProps) {
  const [url, setUrl] = useState("")
  const [isScanning, setIsScanning] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [error, setError] = useState<string | null>(null)

  // We keep the analysis result around if it lands before the animation
  // finishes, then commit it once both are done.
  const pendingResult = useRef<AnalyzeResponse | null>(null)
  const animationDone = useRef(false)
  const onAnalyzeCompleteRef = useRef(onAnalyzeComplete)
  useEffect(() => {
    onAnalyzeCompleteRef.current = onAnalyzeComplete
  }, [onAnalyzeComplete])

  const monthlyRemaining = Math.max(0, creditLimit - creditsUsed)
  const remainingCredits = monthlyRemaining + topupBalance

  useEffect(() => {
    if (!isScanning) return

    animationDone.current = false
    setCurrentStep(-1)

    const timers: ReturnType<typeof setTimeout>[] = []
    scanSteps.forEach((_, i) => {
      timers.push(setTimeout(() => setCurrentStep(i), scanSteps[i].delay))
    })

    timers.push(
      setTimeout(() => {
        animationDone.current = true
        const result = pendingResult.current
        if (result) {
          pendingResult.current = null
          setIsScanning(false)
          setCurrentStep(-1)
          onAnalyzeCompleteRef.current(result)
        }
      }, 3200),
    )

    return () => timers.forEach(clearTimeout)
  }, [isScanning])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return

    setError(null)

    const allowed = onAnalyzeStart()
    if (!allowed) return

    setIsScanning(true)

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; stage?: string }
          | null
        const detail = data?.error?.trim()
        throw new Error(
          detail ||
            (res.status === 502
              ? "Couldn't reach this gig (502). If you used a fiverr.com/s/… share link, open it in your browser and paste the full https://www.fiverr.com/<seller>/<gig-name> URL instead."
              : `Request failed with status ${res.status}`),
        )
      }

      const data = (await res.json()) as AnalyzeResponse

      if (animationDone.current) {
        setIsScanning(false)
        setCurrentStep(-1)
        onAnalyzeCompleteRef.current(data)
      } else {
        pendingResult.current = data
      }
    } catch (err) {
      pendingResult.current = null
      setIsScanning(false)
      setCurrentStep(-1)
      setError(err instanceof Error ? err.message : "Something went wrong")
    }
  }

  // Outer container OWNS the scroll. Inner wrapper uses `min-h-full` so
  // it centers the hero vertically when content is short, but grows
  // (and lets the outer scroll) when content is tall — avoiding the
  // classic `flex justify-center + overflow-auto` trap where the top of
  // the page becomes unreachable on shorter viewports.
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col items-center px-4 py-8 sm:justify-center sm:px-6 sm:py-12">
        <div className="w-full max-w-2xl">
        <WelcomeBanner creditsUsed={creditsUsed} />

        {/* Hero */}
        <div className="mb-8 text-center sm:mb-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald animate-pulse-glow" />
            Fiverr + Upwork AI
          </div>
          <div
            className={`mb-4 inline-flex ml-2 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              isPremiumUser
                ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
            }`}
          >
            {remainingCredits} AI credit{remainingCredits !== 1 ? "s" : ""} remaining
            {topupBalance > 0 && (
              <span className="opacity-80">
                {" "}
                · {monthlyRemaining} monthly + {topupBalance} top-up
              </span>
            )}
            {isPremiumUser && " · Pro"}
          </div>
          <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Audit a Fiverr gig — or write an Upwork proposal.
          </h1>
          <p className="mt-3 text-pretty text-sm text-muted-foreground leading-relaxed sm:mt-4 sm:text-base lg:text-lg">
            Paste a Fiverr URL below for a ranking audit, or open{" "}
            <span className="text-foreground/90">Upwork</span> in the sidebar to
            turn a job post into a tailored proposal.
          </p>
        </div>

        {/* URL Input */}
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="url"
                placeholder="https://www.fiverr.com/your-gig-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isScanning}
                className="h-12 w-full rounded-lg border border-border bg-secondary pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald focus:ring-1 focus:ring-emerald/50 focus:outline-none disabled:opacity-50 transition-colors"
              />
            </div>
            <Button
              type="submit"
              disabled={!url.trim() || isScanning}
              className="h-12 bg-emerald px-6 text-sm font-semibold text-primary-foreground hover:bg-emerald/90 disabled:opacity-50"
            >
              {isScanning ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                "Analyze Gig"
              )}
            </Button>
          </div>
        </form>

        {/* Error */}
        {error && !isScanning && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">Analysis failed</div>
              <div className="text-xs text-danger/80">{error}</div>
            </div>
          </div>
        )}

        {/* Scanning Preview */}
        {isScanning && (
          <Card className="mt-6 border-border bg-card">
            <CardContent className="py-4">
              <div className="flex flex-col gap-3">
                {scanSteps.map((step, i) => {
                  const isActive = currentStep >= i
                  const isCurrent = currentStep === i
                  return (
                    <div
                      key={step.label}
                      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-300 ${
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground/40"
                      } ${isCurrent ? "bg-emerald/5" : ""}`}
                    >
                      <step.icon
                        className={`size-4 shrink-0 transition-colors duration-300 ${
                          isActive ? "text-emerald" : "text-muted-foreground/30"
                        }`}
                      />
                      <span>{step.label}</span>
                      {isCurrent && (
                        <div className="ml-auto h-0.5 w-16 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full w-1/2 rounded-full bg-emerald animate-scan-line" />
                        </div>
                      )}
                      {isActive && !isCurrent && (
                        <CheckCircle className="ml-auto size-3.5 text-emerald" />
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Honest product truths — no invented vanity metrics. */}
        {!isScanning && (
          <div className="mt-8 grid grid-cols-3 gap-4 text-center sm:mt-12 sm:gap-6">
            {[
              { label: "Marketplaces", value: "Fiverr + Upwork" },
              { label: "What you get", value: "Paste-ready fixes" },
              { label: "Visibility stack", value: "SEO · AEO · GEO" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-base font-bold text-foreground sm:text-lg md:text-xl">
                  {stat.value}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
