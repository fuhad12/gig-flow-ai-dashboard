"use client"

/**
 * Upwork proposal writer — paste a job post, get a tailored proposal.
 * Profile niches/skills from Settings pre-fill the form; only the job
 * post is required.
 */

import { useEffect, useState, type FormEvent } from "react"
import {
  AlertCircle,
  Briefcase,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  PenLine,
  Sparkles,
  Target,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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

import type { UpworkProposal } from "@/lib/proposal-types"
import { buildSkillsFromTags } from "@/lib/profile-optimizer-types"

export { buildSkillsFromTags }

const EXTRAS_KEY = "jobflow.proposal.extras.v1"

interface ProposalViewProps {
  /** Niche display name from Settings (or slug fallback). */
  defaultNiche?: string
  /** Deliverables sentence built from skill tags. */
  defaultSkills?: string
  /** Tools / stack — usually skill tags joined. */
  defaultTools?: string
  /** Whether fields were seeded from the signed-in profile. */
  fromProfile?: boolean
  /** Client-side credit pre-check — return false to abort (opens paywall). */
  onCreditStart?: () => boolean
  /** Bump the dashboard credit counter after a successful write. */
  onCreditUsed?: () => void
  onUpgrade?: () => void
}

export function ProposalView({
  defaultNiche = "",
  defaultSkills = "",
  defaultTools = "",
  fromProfile = false,
  onCreditStart,
  onCreditUsed,
  onUpgrade,
}: ProposalViewProps) {
  const [jobText, setJobText] = useState("")
  const [jobUrl, setJobUrl] = useState("")
  const [niche, setNiche] = useState(defaultNiche)
  const [skills, setSkills] = useState(defaultSkills)
  const [tools, setTools] = useState(defaultTools)
  const [experience, setExperience] = useState("")
  const [tone, setTone] = useState<"professional" | "friendly" | "direct">(
    "professional",
  )
  const [bidHint, setBidHint] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UpworkProposal | null>(null)

  // Keep in sync if Settings niches/skills load or change after mount.
  useEffect(() => {
    if (defaultNiche) setNiche((prev) => prev || defaultNiche)
  }, [defaultNiche])
  useEffect(() => {
    if (defaultSkills) setSkills((prev) => prev || defaultSkills)
  }, [defaultSkills])
  useEffect(() => {
    if (defaultTools) setTools((prev) => prev || defaultTools)
  }, [defaultTools])

  // Restore optional extras the user typed last time (experience / bid).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXTRAS_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as {
        experience?: string
        bidHint?: string
        tools?: string
      }
      if (saved.experience) setExperience(saved.experience)
      if (saved.bidHint) setBidHint(saved.bidHint)
      if (saved.tools && !defaultTools) setTools(saved.tools)
    } catch {
      // ignore
    }
  }, [defaultTools])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (onCreditStart && !onCreditStart()) return

    setLoading(true)
    try {
      try {
        localStorage.setItem(
          EXTRAS_KEY,
          JSON.stringify({
            experience,
            bidHint,
            tools,
          }),
        )
      } catch {
        // ignore
      }

      const res = await fetch("/api/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobText,
          jobUrl: jobUrl || undefined,
          niche: niche || undefined,
          skills: skills || undefined,
          tools: tools || undefined,
          experience: experience || undefined,
          tone,
          bidHint: bidHint ? Number(bidHint) : undefined,
        }),
      })
      const data = (await res.json()) as {
        proposal?: UpworkProposal
        error?: string
      }
      if (res.status === 402) {
        onUpgrade?.()
        throw new Error(data.error || "Out of AI credits")
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      if (!data.proposal) {
        throw new Error("No proposal returned")
      }
      setResult(data.proposal)
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
          <Briefcase className="size-5 text-emerald" />
          Upwork proposal writer
        </h1>
        <p className="text-sm text-muted-foreground">
          Paste a job post. Niche, skills, and tools pull from your Settings
          profile — only the job text is required.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="size-4 text-emerald" />
              Job + your profile
            </CardTitle>
            <CardDescription>
              {fromProfile
                ? "Profile fields are pre-filled from Settings. Edit anytime — uses 1 AI credit."
                : "Copy the Upwork job description. Set niches & skills in Settings for auto-fill. Uses 1 AI credit."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="job-text">Job post *</Label>
                <Textarea
                  id="job-text"
                  required
                  rows={8}
                  value={jobText}
                  onChange={(e) => setJobText(e.target.value)}
                  placeholder="Paste the full Upwork job description here…"
                  className="min-h-[160px] text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="job-url">Job URL (optional)</Label>
                <Input
                  id="job-url"
                  type="url"
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                  placeholder="https://www.upwork.com/jobs/…"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="niche">
                    Your niche{" "}
                    {fromProfile && niche ? (
                      <span className="font-normal text-muted-foreground">
                        (from profile)
                      </span>
                    ) : null}
                  </Label>
                  <Input
                    id="niche"
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    placeholder="e.g. Next.js SaaS development"
                  />
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

              <div className="space-y-1.5">
                <Label htmlFor="skills">
                  What you deliver{" "}
                  {fromProfile && skills ? (
                    <span className="font-normal text-muted-foreground">
                      (from profile)
                    </span>
                  ) : null}
                </Label>
                <Textarea
                  id="skills"
                  rows={3}
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                  placeholder="Set skill tags in Settings — or type what you deliver here…"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tools">
                    Tools{" "}
                    {fromProfile && tools ? (
                      <span className="font-normal text-muted-foreground">
                        (from profile)
                      </span>
                    ) : (
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    )}
                  </Label>
                  <Input
                    id="tools"
                    value={tools}
                    onChange={(e) => setTools(e.target.value)}
                    placeholder="React, Supabase, Stripe"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bid">Bid hint USD (optional)</Label>
                  <Input
                    id="bid"
                    type="number"
                    min={5}
                    value={bidHint}
                    onChange={(e) => setBidHint(e.target.value)}
                    placeholder="e.g. 800"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="experience">Proof / experience (optional)</Label>
                <Textarea
                  id="experience"
                  rows={2}
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  placeholder="e.g. 12 SaaS launches, 4.9★ on similar builds, 3-day MVP turnaround…"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || !jobText.trim()}
                className="w-full gap-2 bg-emerald text-primary-foreground hover:bg-emerald/90"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Writing proposal…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Write proposal
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
                  Your tailored proposal will show up here.
                </p>
              </CardContent>
            </Card>
          )}

          {loading && (
            <Card className="border-border bg-card">
              <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-emerald" />
                Reading the job and drafting…
              </CardContent>
            </Card>
          )}

          {result && <ProposalResult result={result} />}
        </div>
      </div>
    </div>
  )
}

function ProposalResult({ result }: { result: UpworkProposal }) {
  return (
    <div className="space-y-4">
      <Card className="border-emerald/30 bg-emerald/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald" />
            <span className="text-sm font-medium text-foreground">
              Fit score
            </span>
            <Badge
              variant="outline"
              className="border-emerald/40 text-emerald"
            >
              {Math.round(result.fitScore)}/100
            </Badge>
          </div>
          {result.suggestedBid != null && (
            <div className="text-sm text-muted-foreground">
              Suggested bid:{" "}
              <span className="font-semibold text-foreground">
                ${result.suggestedBid.toLocaleString("en-US")}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-sm">Opening hook</CardTitle>
            <CardDescription className="text-xs">
              First line clients actually read
            </CardDescription>
          </div>
          <CopyButton text={result.hook} />
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium text-foreground">{result.hook}</p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-sm">Full proposal</CardTitle>
            <CardDescription className="text-xs">
              Paste into Upwork ·{" "}
              {result.proposal.split(/\s+/).filter(Boolean).length} words
            </CardDescription>
          </div>
          <CopyButton text={result.proposal} />
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {result.proposal}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Why this should win</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 pl-4 text-sm text-muted-foreground [&>li]:list-disc">
            {result.winAngles.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-amber-700 dark:text-amber-300">
            Customize before you send
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 pl-4 text-sm text-muted-foreground [&>li]:list-disc">
            {result.customizeChecklist.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
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
