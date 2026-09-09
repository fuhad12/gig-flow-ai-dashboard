"use client"

/**
 * Shared SEO / AEO / GEO / AIO checklist + scores for audits, proposals,
 * and profile optimizer.
 */

import {
  CheckCircle2,
  MessageSquareText,
  Quote,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type {
  QaPair,
  VisibilityChecklistItem,
  VisibilityLayer,
} from "@/lib/visibility-types"
import { LAYER_SHORT } from "@/lib/visibility-types"

function layerBadgeClass(layer: VisibilityLayer): string {
  switch (layer) {
    case "seo":
      return "border-border text-muted-foreground"
    case "aeo":
      return "border-sky-500/30 text-sky-700 dark:text-sky-300"
    case "geo":
      return "border-violet-500/30 text-violet-700 dark:text-violet-300"
    case "aio":
      return "border-emerald/30 text-emerald"
  }
}

function scoreTone(score: number): string {
  if (score >= 75) return "text-emerald"
  if (score >= 50) return "text-warning"
  return "text-danger"
}

interface VisibilityPanelProps {
  title?: string
  description?: string
  answerReadinessScore?: number | null
  geoCiteScore?: number | null
  /** Alias used on proposals (AI recommendability). */
  aiRecommendScore?: number | null
  aiRecommendNote?: string | null
  answerReadinessNotes?: string[]
  proofQuotes?: string[]
  faqs?: QaPair[]
  checklist?: VisibilityChecklistItem[]
  /** Optional label for the FAQ block (gig FAQs vs screening Qs). */
  faqTitle?: string
}

export function VisibilityPanel({
  title = "Visibility — get found, chosen, and cited",
  description = "SEO ranks you. AEO makes you the answer. GEO gets you recommended when clients ask AI.",
  answerReadinessScore,
  geoCiteScore,
  aiRecommendScore,
  aiRecommendNote,
  answerReadinessNotes = [],
  proofQuotes = [],
  faqs = [],
  checklist = [],
  faqTitle = "Suggested FAQs",
}: VisibilityPanelProps) {
  const hasScores =
    answerReadinessScore != null ||
    geoCiteScore != null ||
    aiRecommendScore != null
  const hasBody =
    hasScores ||
    answerReadinessNotes.length > 0 ||
    proofQuotes.length > 0 ||
    faqs.length > 0 ||
    checklist.length > 0

  if (!hasBody) return null

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-3.5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasScores && (
          <div className="flex flex-wrap gap-2">
            {answerReadinessScore != null && (
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  AEO · Answer ready
                </div>
                <div
                  className={`text-sm font-bold tabular-nums ${scoreTone(answerReadinessScore)}`}
                >
                  {Math.round(answerReadinessScore)}/100
                </div>
              </div>
            )}
            {geoCiteScore != null && (
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  GEO · AI cite
                </div>
                <div
                  className={`text-sm font-bold tabular-nums ${scoreTone(geoCiteScore)}`}
                >
                  {Math.round(geoCiteScore)}/100
                </div>
              </div>
            )}
            {aiRecommendScore != null && (
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  GEO · AI would recommend
                </div>
                <div
                  className={`text-sm font-bold tabular-nums ${scoreTone(aiRecommendScore)}`}
                >
                  {Math.round(aiRecommendScore)}/100
                </div>
              </div>
            )}
          </div>
        )}

        {aiRecommendNote?.trim() && (
          <p className="text-sm text-muted-foreground">{aiRecommendNote}</p>
        )}

        {answerReadinessNotes.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <MessageSquareText className="size-3.5" />
              Answer gaps
            </div>
            <ul className="space-y-1 pl-4 text-sm text-muted-foreground [&>li]:list-disc">
              {answerReadinessNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        {proofQuotes.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Quote className="size-3.5" />
              Proof quotes AI can lift
            </div>
            <ul className="space-y-2">
              {proofQuotes.map((q, i) => (
                <li
                  key={i}
                  className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground"
                >
                  “{q}”
                </li>
              ))}
            </ul>
          </div>
        )}

        {faqs.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {faqTitle}
            </div>
            <ul className="space-y-3">
              {faqs.map((f, i) => (
                <li key={i} className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {f.question}
                  </p>
                  <p className="text-sm text-muted-foreground">{f.answer}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {checklist.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <CheckCircle2 className="size-3.5" />
              This week
            </div>
            <ol className="space-y-2.5">
              {checklist.map((item, i) => (
                <li key={`${item.id}-${i}`} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${layerBadgeClass(item.layer)}`}
                      >
                        {LAYER_SHORT[item.layer]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
