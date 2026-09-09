"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Wand2,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  Sparkles,
  Tag,
  Package,
  HelpCircle,
  Image as ImageIcon,
  Search,
  FileText,
  ClipboardList,
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
import { ScrollArea } from "@/components/ui/scroll-area"

import {
  NICHES,
  DEFAULT_NICHE_SLUG,
  getNiche,
  getNicheDisplayName,
  isCustomNiche,
} from "@/lib/niches"

/**
 * Per-niche example placeholders for the "Skill" and "Tools" inputs in the
 * generator form. Falls back to neutral examples when a niche has no entry.
 */
const NICHE_PLACEHOLDERS: Record<
  string,
  { skill: string; tools: string; audience: string }
> = {
  "logo-design": {
    skill: "e.g. Design minimalist vector logos and full brand identity packages for tech startups",
    tools: "Adobe Illustrator, Figma, Procreate",
    audience: "e.g. SaaS founders, indie startups, small businesses",
  },
  "video-editing": {
    skill: "e.g. Edit YouTube long-form, TikTok reels, and short-form ads with motion graphics",
    tools: "Premiere Pro, After Effects, DaVinci Resolve, CapCut",
    audience: "e.g. YouTubers, agencies, course creators",
  },
  voiceover: {
    skill: "e.g. Record warm American-accent commercial, explainer, and e-learning voiceovers",
    tools: "Audacity, Adobe Audition, broadcast mic",
    audience: "e.g. agencies, animation studios, e-learning companies",
  },
  "content-writing": {
    skill: "e.g. Write long-form SEO articles and ghostwritten blog posts for B2B SaaS founders",
    tools: "Surfer SEO, Grammarly, Ahrefs",
    audience: "e.g. B2B SaaS founders, marketing managers",
  },
  copywriting: {
    skill: "e.g. Write high-converting sales pages, email sequences, and landing page copy",
    tools: "Klaviyo, ConvertKit, Hemingway",
    audience: "e.g. ecommerce brands, course creators, agencies",
  },
  illustration: {
    skill: "e.g. Create custom character illustrations and children's book art in a playful style",
    tools: "Procreate, Adobe Fresco, Photoshop",
    audience: "e.g. authors, indie game studios, parents",
  },
  "ui-ux": {
    skill: "e.g. Design conversion-focused SaaS dashboards and mobile app UI in Figma",
    tools: "Figma, Framer, Notion",
    audience: "e.g. SaaS founders, product managers",
  },
  seo: {
    skill: "e.g. Run on-page SEO audits and build white-hat backlinks for local businesses",
    tools: "Ahrefs, SEMrush, Google Search Console",
    audience: "e.g. local businesses, ecommerce brands",
  },
  "social-media": {
    skill: "e.g. Manage Instagram and TikTok content calendars with weekly carousels and reels",
    tools: "Canva, Buffer, Later, CapCut",
    audience: "e.g. personal brands, small businesses, coaches",
  },
  translation: {
    skill: "e.g. Translate English to Spanish documents and websites with native fluency",
    tools: "Trados, MemoQ, native fluency",
    audience: "e.g. agencies, ecommerce stores expanding to LATAM",
  },
  "virtual-assistant": {
    skill: "e.g. Provide executive assistant support — inbox, calendar, lead research",
    tools: "Notion, ClickUp, Google Workspace",
    audience: "e.g. solo founders, busy executives, coaches",
  },
  "web-development": {
    skill: "e.g. Build production-ready Next.js SaaS apps with Stripe billing and Supabase auth",
    tools: "Next.js, Supabase, Stripe, Tailwind",
    audience: "e.g. solo founders, indie hackers, agencies",
  },
  "ai-apps": {
    skill: "e.g. Build OpenAI-powered chatbots and RAG-backed knowledge assistants",
    tools: "OpenAI, LangChain, Pinecone, Cursor",
    audience: "e.g. AI-first startups, internal tooling teams",
  },
  "no-code": {
    skill: "e.g. Ship Lovable / Bubble MVPs end-to-end in under 2 weeks",
    tools: "Lovable, Bubble, Webflow, Airtable",
    audience: "e.g. non-technical founders, validators",
  },
  "mobile-apps": {
    skill: "e.g. Build cross-platform React Native apps with Expo and Firebase backend",
    tools: "React Native, Expo, Firebase",
    audience: "e.g. startups, indie hackers",
  },
  "data-science": {
    skill: "e.g. Build Python data pipelines and RAG-backed analytics dashboards",
    tools: "Python, Pandas, LangChain, Power BI",
    audience: "e.g. mid-market companies, data teams",
  },
}
const FALLBACK_PLACEHOLDER = {
  skill: "e.g. The exact service you're going to deliver — be specific",
  tools: "Comma-separated tools / styles / techniques you use",
  audience: "e.g. the typical buyer for this niche",
}
import {
  classifyLength,
  countKeywordOccurrences,
  FIVERR,
  keywordCorpus,
  type LengthTone,
} from "@/lib/fiverr-limits"
import {
  FiverrWarningDialog,
  shouldShowFiverrWarning,
  type FiverrWarningVariant,
} from "@/components/fiverr-warning-dialog"
import type {
  GenerateResponse,
  GigGeneration,
} from "@/lib/generation-types"

interface GeneratorViewProps {
  /**
   * Called before the request is sent. Mirrors `onAnalyzeStart` on the
   * landing view: returns `false` when the user has no remaining credits
   * (and opens the paywall as a side-effect), `true` to proceed. Without
   * this client-side pre-gate the user could spend ~60s waiting for an
   * LLM call that the server is going to 402 anyway.
   */
  onGenerateStart?: () => boolean
  onQuotaExceeded?: () => void
  /**
   * Called after a successful generation so the dashboard can bump its
   * live "credits used this month" counter. The server already persists
   * the credit; this just keeps the local UI honest until the next reload.
   */
  onCreditUsed?: () => void
  /**
   * Optional pre-selected niche slug. Used when the user hops in from the
   * Trends view via "Generate gig in this niche".
   */
  initialNiche?: string
  /**
   * Optional pre-filled skill string. Used by the keyword-discovery card
   * in Trends to seed the generator with a chosen long-tail phrase.
   */
  initialSkill?: string
  /**
   * Optional tools / stack seed — usually the user's skill tags joined.
   */
  initialTools?: string
  /**
   * User's pinned niches from Settings. Custom niches (those not in the
   * predefined catalog) are merged into the niche dropdown so users can
   * generate gigs for their own niche, not just the curated ones.
   * Predefined slugs in this list are ignored — they're already in
   * the dropdown.
   */
  userNiches?: string[]
}

export function GeneratorView({
  onGenerateStart,
  onQuotaExceeded,
  onCreditUsed,
  initialNiche,
  initialSkill,
  initialTools,
  userNiches,
}: GeneratorViewProps) {
  // Build the dropdown's option list once per `userNiches` change. The
  // predefined catalog is always shown; custom slugs from the user's
  // pinned niches are appended underneath so power users see "their"
  // niche without losing access to the curated ones.
  const nicheOptions = useMemo(() => {
    const customs = (userNiches ?? []).filter(isCustomNiche)
    return [
      ...NICHES.map((n) => ({ slug: n.slug, name: n.name, custom: false })),
      ...customs.map((slug) => ({
        slug,
        name: getNicheDisplayName(slug),
        custom: true,
      })),
    ]
  }, [userNiches])
  const [niche, setNiche] = useState<string>(initialNiche ?? DEFAULT_NICHE_SLUG)
  const [skill, setSkill] = useState(initialSkill ?? "")
  const [toolsInput, setToolsInput] = useState(initialTools ?? "")
  const [audience, setAudience] = useState("")
  const [experience, setExperience] = useState<
    "beginner" | "intermediate" | "expert"
  >("intermediate")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GigGeneration | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [savedDrafts, setSavedDrafts] = useState<
    { id: string; niche: string; generation: GigGeneration; createdAt: string }[]
  >([])
  const [loadingDrafts, setLoadingDrafts] = useState(true)

  useEffect(() => {
    if (initialNiche) setNiche(initialNiche)
  }, [initialNiche])

  useEffect(() => {
    if (initialSkill) setSkill((prev) => prev || initialSkill)
  }, [initialSkill])

  useEffect(() => {
    if (initialTools) setToolsInput((prev) => prev || initialTools)
  }, [initialTools])

  // Restore drafts saved server-side so leaving the page doesn't lose them.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingDrafts(true)
      try {
        const res = await fetch("/api/generations?limit=10")
        if (!res.ok) return
        const data = (await res.json()) as {
          items: {
            id: string
            niche: string
            generation: GigGeneration
            createdAt: string
          }[]
        }
        if (cancelled) return
        const items = (data.items ?? []).filter(
          (i) =>
            i.generation?.title &&
            !String(i.generation.title).startsWith("[pending") &&
            (i.generation as { kind?: string }).kind !== "upwork_proposal" &&
            (i.generation as { kind?: string }).kind !== "profile_optimizer",
        )
        setSavedDrafts(items)
        // If there's no live result yet, show the most recent draft.
        if (items[0]?.generation) {
          setResult((prev) => prev ?? items[0].generation)
        }
      } catch {
        // ignore — drafts are a convenience
      } finally {
        if (!cancelled) setLoadingDrafts(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const placeholders = useMemo(() => {
    return NICHE_PLACEHOLDERS[niche] ?? {
      ...FALLBACK_PLACEHOLDER,
      // If the niche has trendingTerms, weave them into the tools placeholder.
      tools:
        getNiche(niche)?.trendingTerms?.slice(0, 5).join(", ") ??
        FALLBACK_PLACEHOLDER.tools,
    }
  }, [niche])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const tools = toolsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    if (!skill.trim()) {
      setError("Describe the skill you want to sell.")
      return
    }
    if (tools.length === 0) {
      setError("Add at least one tool you use.")
      return
    }

    // Client-side credit pre-check. The server has the authoritative
    // atomic gate (see /api/generate's reserve_credit_slot RPC) but
    // surfacing the paywall up-front avoids a 30-60s LLM round-trip
    // that the server is going to 402 anyway.
    if (onGenerateStart && !onGenerateStart()) return

    setLoading(true)
    setResult(null)
    setWarnings([])
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche,
          skill: skill.trim(),
          tools,
          audience: audience.trim() || undefined,
          experienceLevel: experience,
        }),
      })
      if (res.status === 402) {
        onQuotaExceeded?.()
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(data?.error ?? "Monthly limit reached")
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(
          data?.error ?? `Request failed with status ${res.status}`,
        )
      }
      const data = (await res.json()) as GenerateResponse
      setResult(data.generation)
      setWarnings(data.warnings ?? [])
      setSavedDrafts((prev) => [
        {
          id: `local-${Date.now()}`,
          niche,
          generation: data.generation,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ])
      onCreditUsed?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="mb-5 sm:mb-6">
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
            <Wand2 className="size-5 text-emerald sm:size-6" />
            AI Gig Generator
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Describe your skill — we&apos;ll write the full Fiverr listing
            (title, description, tags, packages, FAQs, requirements, and
            thumbnail concept) tuned to current niche demand and Fiverr&apos;s
            field limits.
          </p>
        </div>

        <Card className="mb-6 border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What are you selling?</CardTitle>
            <CardDescription>
              The more specific, the better the output.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              <div className="space-y-1.5">
                <Label htmlFor="niche">Niche</Label>
                <Select value={niche} onValueChange={setNiche}>
                  <SelectTrigger id="niche" className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {nicheOptions.map((n) => (
                      <SelectItem key={n.slug} value={n.slug}>
                        {n.name}
                        {n.custom && (
                          <span className="ml-1.5 text-[9px] uppercase tracking-wide text-violet-300">
                            custom
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="experience">Experience level</Label>
                <Select
                  value={experience}
                  onValueChange={(v) =>
                    setExperience(v as typeof experience)
                  }
                >
                  <SelectTrigger id="experience" className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="expert">Expert</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="skill">Skill</Label>
                <Textarea
                  id="skill"
                  placeholder={placeholders.skill}
                  value={skill}
                  onChange={(e) => setSkill(e.target.value)}
                  className="min-h-[80px] bg-background"
                  maxLength={300}
                />
                <p className="text-[10px] text-muted-foreground">
                  {skill.length}/300
                </p>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="tools">Tools / stack</Label>
                <Input
                  id="tools"
                  placeholder={placeholders.tools}
                  value={toolsInput}
                  onChange={(e) => setToolsInput(e.target.value)}
                  className="bg-background"
                />
                <p className="text-[10px] text-muted-foreground">
                  Comma-separated. Include the tools / techniques you actually use.
                </p>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="audience">Target audience (optional)</Label>
                <Input
                  id="audience"
                  placeholder={placeholders.audience}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="bg-background"
                />
              </div>

              <div className="md:col-span-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full gap-2 bg-emerald text-primary-foreground hover:bg-emerald/90 sm:w-auto"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      Generate listing
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {savedDrafts.length > 0 && (
          <Card className="mb-6 border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Saved drafts</CardTitle>
              <CardDescription>
                Generations are stored on your account. Open one after you leave
                this page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {savedDrafts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setResult(d.generation)
                    setWarnings([])
                    if (d.niche) setNiche(d.niche)
                  }}
                  className="flex w-full items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-emerald/40"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {d.generation.title || "Untitled draft"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {getNicheDisplayName(d.niche)} ·{" "}
                      {new Date(d.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    Open
                  </Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {loading && !result && (
          <Card className="border-border bg-card">
            <CardContent className="flex items-center gap-3 py-12">
              <Loader2 className="size-5 animate-spin text-emerald" />
              <span className="text-sm text-muted-foreground">
                Writing your listing... usually 10–20 seconds.
              </span>
            </CardContent>
          </Card>
        )}

        {result && <ResultDisplay result={result} warnings={warnings} />}
      </div>
    </ScrollArea>
  )
}

// ---------- Result rendering ----------

function ResultDisplay({
  result,
  warnings,
}: {
  result: GigGeneration
  warnings: string[]
}) {
  const kw = result.primaryKeyword
  const descCount = useMemo(
    () => countKeywordOccurrences(keywordCorpus({ description: result.description }), kw),
    [result.description, kw],
  )
  const titleCount = useMemo(
    () => countKeywordOccurrences(result.title, kw),
    [result.title, kw],
  )
  const tagsContaining = useMemo(
    () =>
      result.tags.filter((t) => countKeywordOccurrences(t, kw) >= 1).length,
    [result.tags, kw],
  )

  // Floor + ceiling for every signal. Falling outside the range in
  // EITHER direction is a problem in 2026 — under-floor = no relevance
  // signal, over-ceiling = Fiverr flags it as spam. Same `LengthTone`
  // vocabulary the rest of the UI uses: "optimal" = in range,
  // "under" = below floor, "over-max" = above ceiling.
  const K = FIVERR.keyword
  const rangeTone = (count: number, min: number, max: number): LengthTone => {
    if (count < min) return "under"
    if (count > max) return "over-max"
    return "optimal"
  }
  const kwTone = rangeTone(descCount, K.descMin, K.descMax)
  const titleTone = rangeTone(titleCount, K.titleMin, K.titleMax)
  const tagsTone = rangeTone(tagsContaining, K.tagMin, K.tagMax)

  return (
    <div className="space-y-4">
      <Card className="border-emerald/30 bg-emerald/5">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Target className="mt-0.5 size-5 shrink-0 text-emerald" />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald">
                Primary Keyword
              </div>
              <div className="mt-0.5 text-base font-semibold text-foreground">
                {kw}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {K.descMin}-{K.descMax}× in description,
                {" "}{K.titleMin}-{K.titleMax}× in title,
                {" "}{K.tagMin}-{K.tagMax} of {FIVERR.tag.count} tags.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ToneChip tone={kwTone}>
              Desc {descCount}/{K.descMin}-{K.descMax}
            </ToneChip>
            <ToneChip tone={titleTone}>
              Title {titleCount}/{K.titleMin}-{K.titleMax}
            </ToneChip>
            <ToneChip tone={tagsTone}>
              Tags {tagsContaining}/{K.tagMin}-{K.tagMax}
            </ToneChip>
          </div>
        </CardContent>
      </Card>

      {warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-0.5">
            <div className="font-medium">Heads up</div>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Section
        icon={<Sparkles className="size-4 text-emerald" />}
        title="Title"
        subtitle="Paste into Fiverr's gig title field"
        copyText={result.title}
        copyWarning="title-lock"
        counter={
          <CharCounter
            length={result.title.length}
            max={FIVERR.title.max}
            optimalMin={FIVERR.title.optimalMin}
            optimalMax={FIVERR.title.optimalMax}
            label="title"
          />
        }
      >
        <p className="text-sm font-medium text-foreground">{result.title}</p>
      </Section>

      <Section
        icon={<FileText className="size-4 text-emerald" />}
        title="Description"
        subtitle={`${result.description.split(/\s+/).filter(Boolean).length} words`}
        copyText={result.description}
        counter={
          <CharCounter
            length={result.description.length}
            max={FIVERR.description.max}
            optimalMin={FIVERR.description.optimalMin}
            optimalMax={FIVERR.description.optimalMax}
            label="description"
          />
        }
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {result.description}
        </p>
      </Section>

      <Section
        icon={<Tag className="size-4 text-emerald" />}
        title="Search Tags"
        subtitle={`Paste into Fiverr's ${FIVERR.tag.count} tag fields`}
        copyText={result.tags.join(", ")}
      >
        <div className="flex flex-wrap gap-2">
          {result.tags.map((t, i) => {
            const tone = classifyLength({ length: t.length, max: FIVERR.tag.max })
            return (
              <Badge
                key={`${t}-${i}`}
                variant="outline"
                className={
                  tone === "over-max"
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-emerald/30 bg-emerald/5 text-emerald"
                }
              >
                <span>{t}</span>
                <span className="ml-1.5 text-[9px] opacity-70">
                  {t.length}/{FIVERR.tag.max}
                </span>
              </Badge>
            )
          })}
        </div>
      </Section>

      <Section
        icon={<Search className="size-4 text-emerald" />}
        title="Long-tail Keywords"
        subtitle="Brainstorm — weave these into your title, description, and FAQs"
        copyText={result.searchKeywords.join("\n")}
      >
        <div className="flex flex-wrap gap-2">
          {result.searchKeywords.map((k, i) => (
            <Badge
              key={`${k}-${i}`}
              variant="outline"
              className="border-border text-muted-foreground"
            >
              {k}
            </Badge>
          ))}
        </div>
      </Section>

      <Section
        icon={<Package className="size-4 text-emerald" />}
        title="Packages"
        subtitle="3 tiers, paste-ready"
      >
        <div className="grid gap-3 md:grid-cols-3">
          {result.packages.map((p) => (
            <PackageCard key={p.tier} pkg={p} />
          ))}
        </div>
      </Section>

      <Section
        icon={<HelpCircle className="size-4 text-emerald" />}
        title="FAQs"
        subtitle={`${result.faqs.length} questions`}
        copyText={result.faqs
          .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
          .join("\n\n")}
      >
        <ul className="space-y-3">
          {result.faqs.map((f, i) => (
            <li key={i} className="border-l-2 border-emerald/40 pl-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-foreground">
                  {f.question}
                </div>
                <CharCounter
                  length={f.question.length}
                  max={FIVERR.faq.question.max}
                  label="question"
                  compact
                />
              </div>
              <div className="mt-0.5 flex items-start justify-between gap-2">
                <div className="text-xs text-muted-foreground">{f.answer}</div>
                <CharCounter
                  length={f.answer.length}
                  max={FIVERR.faq.answer.max}
                  label="answer"
                  compact
                />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {((result.buyerAiQuestions?.length ?? 0) > 0 ||
        (result.visibilityActions?.length ?? 0) > 0) && (
        <Section
          icon={<Sparkles className="size-4 text-emerald" />}
          title="Visibility — AEO & GEO"
          subtitle="Own the questions clients ask AI, then ship the listing checklist"
          copyText={[
            ...(result.buyerAiQuestions ?? []).map((q) => `Q: ${q}`),
            "",
            ...(result.visibilityActions ?? []).map((a, i) => `${i + 1}. ${a}`),
          ].join("\n")}
        >
          <div className="space-y-4">
            {(result.buyerAiQuestions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Questions buyers ask AI
                </p>
                <ul className="space-y-1.5 pl-4 text-sm text-muted-foreground [&>li]:list-disc">
                  {result.buyerAiQuestions!.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            {(result.visibilityActions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  After you publish
                </p>
                <ol className="space-y-1.5 pl-4 text-sm text-muted-foreground [&>li]:list-decimal">
                  {result.visibilityActions!.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section
        icon={<ClipboardList className="size-4 text-emerald" />}
        title="Buyer Requirements"
        subtitle={`${result.requirements.length} prompts your buyer will answer at order time`}
        copyText={result.requirements
          .map((r, i) => `${i + 1}. ${r}`)
          .join("\n")}
      >
        <ol className="space-y-2">
          {result.requirements.map((r, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 text-[11px] font-semibold text-emerald">
                {i + 1}.
              </span>
              <div className="flex-1">
                <div className="text-sm text-foreground/90">{r}</div>
                <CharCounter
                  length={r.length}
                  max={FIVERR.requirement.item.max}
                  label="requirement"
                  compact
                />
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        icon={<ImageIcon className="size-4 text-emerald" />}
        title="Thumbnail Concepts"
        subtitle="Brief a designer or paste the AI prompt into Midjourney/DALL-E"
      >
        <ul className="mb-3 space-y-1">
          {result.thumbnailIdeas.map((idea, i) => (
            <li
              key={i}
              className="flex gap-2 text-sm text-muted-foreground"
            >
              <span className="text-emerald">•</span>
              <span>{idea}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-md border border-emerald/20 bg-emerald/5 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald">
              AI Image Prompt
            </span>
            <CopyButton text={result.gigImagePrompt} size="xs" />
          </div>
          <p className="text-xs leading-relaxed text-foreground/90">
            {result.gigImagePrompt}
          </p>
        </div>
      </Section>
    </div>
  )
}

interface SectionProps {
  icon: React.ReactNode
  title: string
  subtitle?: string
  copyText?: string
  counter?: React.ReactNode
  children: React.ReactNode
  /**
   * Optional Fiverr-side warning to show before the copy fires.
   * Used on the Title section so users are reminded that Fiverr
   * permanently binds the gig URL to the first saved title.
   */
  copyWarning?: FiverrWarningVariant
}

function Section({
  icon,
  title,
  subtitle,
  copyText,
  counter,
  children,
  copyWarning,
}: SectionProps) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            {icon}
            {title}
          </CardTitle>
          {subtitle && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {counter}
          {copyText && (
            <CopyButton text={copyText} warningVariant={copyWarning} />
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

function PackageCard({
  pkg,
}: {
  pkg: GigGeneration["packages"][number]
}) {
  const tierTone =
    pkg.tier === "Premium"
      ? "border-emerald/40 bg-emerald/5"
      : pkg.tier === "Standard"
        ? "border-emerald/20"
        : "border-border"

  const paste = [
    `${pkg.tier} — ${pkg.name}`,
    `$${pkg.price} · ${pkg.deliveryDays}d · ${pkg.revisions} revisions`,
    "",
    pkg.description,
  ].join("\n")

  return (
    <div className={`rounded-md border ${tierTone} p-3`}>
      <div className="flex items-center justify-between">
        <Badge
          variant="outline"
          className="border-border text-[10px] text-muted-foreground"
        >
          {pkg.tier}
        </Badge>
        <CopyButton text={paste} size="xs" />
      </div>
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">{pkg.name}</div>
        <CharCounter
          length={pkg.name.length}
          max={FIVERR.package.name.max}
          label="name"
          compact
        />
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-emerald">${pkg.price}</span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {pkg.deliveryDays} day delivery · {pkg.revisions} revisions
      </div>
      <div className="mt-3 rounded-sm border border-border/50 bg-background/50 p-2">
        <div className="text-xs leading-relaxed text-foreground/90">
          {pkg.description}
        </div>
        <div className="mt-1 flex justify-end">
          <CharCounter
            length={pkg.description.length}
            max={FIVERR.package.description.max}
            label="description"
            compact
          />
        </div>
      </div>
    </div>
  )
}

function CopyButton({
  text,
  size = "sm",
  warningVariant,
}: {
  text: string
  size?: "xs" | "sm"
  /**
   * When set, gate the actual copy behind a one-time warning dialog
   * (suppressible via session/forever flags). Used on the title so the
   * user is reminded Fiverr binds the gig URL to the first saved title.
   */
  warningVariant?: FiverrWarningVariant
}) {
  const [copied, setCopied] = useState(false)
  const [warnOpen, setWarnOpen] = useState(false)

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can fail in insecure contexts; silently ignore.
    }
  }

  const handle = async () => {
    if (warningVariant && shouldShowFiverrWarning(warningVariant)) {
      setWarnOpen(true)
      return
    }
    await doCopy()
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handle}
        className={
          size === "xs"
            ? "h-6 gap-1 px-1.5 text-[10px]"
            : "h-7 gap-1.5 px-2 text-xs"
        }
      >
        {copied ? (
          <>
            <Check className={size === "xs" ? "size-3" : "size-3.5"} />
            Copied
          </>
        ) : (
          <>
            <Copy className={size === "xs" ? "size-3" : "size-3.5"} />
            Copy
          </>
        )}
      </Button>
      {warningVariant && (
        <FiverrWarningDialog
          variant={warningVariant}
          open={warnOpen}
          onOpenChange={setWarnOpen}
          onConfirm={() => {
            void doCopy()
          }}
        />
      )}
    </>
  )
}

// ---------- Live character counters ----------

interface CharCounterProps {
  length: number
  max: number
  optimalMin?: number
  optimalMax?: number
  label: string
  /** Compact = inline pill without a label prefix. */
  compact?: boolean
}

function CharCounter({
  length,
  max,
  optimalMin,
  optimalMax,
  label,
  compact,
}: CharCounterProps) {
  const tone = classifyLength({ length, max, optimalMin, optimalMax })
  const toneClass = toneClassFor(tone)
  return (
    <span
      title={
        optimalMin && optimalMax
          ? `Fiverr cap ${max}. Optimal range ${optimalMin}-${optimalMax}.`
          : `Fiverr cap ${max}.`
      }
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${toneClass}`}
    >
      {compact ? null : <span className="opacity-70">{label}&nbsp;</span>}
      {length}/{max}
    </span>
  )
}

function ToneChip({
  tone,
  children,
}: {
  tone: LengthTone
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${toneClassFor(tone)}`}
    >
      {children}
    </span>
  )
}

function toneClassFor(tone: LengthTone): string {
  switch (tone) {
    case "optimal":
      return "border-emerald/40 bg-emerald/10 text-emerald"
    case "over-optimal":
      return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    case "under":
      return "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
    case "over-max":
      return "border-danger/40 bg-danger/10 text-danger"
    case "empty":
    default:
      return "border-border bg-background/50 text-muted-foreground"
  }
}
