"use client"

import { useState } from "react"
import { ImageOff, Sparkles, MousePointerClick } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { ThumbnailAnalysis } from "@/lib/analysis-types"

interface ThumbnailCardProps {
  thumbnailUrl: string
  analysis: ThumbnailAnalysis
}

function scoreTone(score: number) {
  if (score >= 75) {
    return {
      text: "text-emerald",
      bg: "bg-emerald/10",
      border: "border-emerald/20",
    }
  }
  if (score >= 50) {
    return {
      text: "text-warning",
      bg: "bg-warning/10",
      border: "border-warning/20",
    }
  }
  return {
    text: "text-danger",
    bg: "bg-danger/10",
    border: "border-danger/20",
  }
}

function ctrTone(potential: "Low" | "Medium" | "High") {
  if (potential === "High") return scoreTone(80)
  if (potential === "Medium") return scoreTone(60)
  return scoreTone(30)
}

export function ThumbnailCard({ thumbnailUrl, analysis }: ThumbnailCardProps) {
  const [imageError, setImageError] = useState(false)

  const scores = [
    { label: "Overall", value: analysis.overallScore },
    { label: "Contrast", value: analysis.contrastScore },
    { label: "Readability", value: analysis.readabilityScore },
  ]
  const ctr = ctrTone(analysis.ctrPotential)

  return (
    <div className="border-b border-border bg-card/30 px-6 py-4">
      <div className="flex flex-col gap-4 md:flex-row">
        {/* Thumbnail image */}
        <div className="relative flex-shrink-0">
          {imageError ? (
            <div className="flex h-[126px] w-[224px] flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted/40 text-muted-foreground">
              <ImageOff className="size-5" />
              <span className="text-[10px]">Image unavailable</span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt="Gig thumbnail"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="h-[126px] w-[224px] rounded-md border border-border object-cover"
            />
          )}
        </div>

        {/* Analysis */}
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-emerald" />
            <h3 className="text-sm font-semibold">Thumbnail Analysis</h3>
            <Badge
              variant="outline"
              className={`ml-auto gap-1 ${ctr.border} ${ctr.bg} ${ctr.text} text-[10px]`}
            >
              <MousePointerClick className="size-3" />
              {analysis.ctrPotential} CTR Potential
            </Badge>
          </div>

          {/* Score chips */}
          <div className="flex flex-wrap gap-2">
            {scores.map((s) => {
              const tone = scoreTone(s.value)
              return (
                <div
                  key={s.label}
                  className={`rounded-md border ${tone.border} ${tone.bg} px-3 py-1.5`}
                >
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </div>
                  <div className={`text-sm font-bold ${tone.text}`}>
                    {Math.round(s.value)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Critiques */}
          {analysis.critiques.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {analysis.critiques.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-danger">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Improved concept */}
          <div className="rounded-md border border-emerald/20 bg-emerald/5 px-3 py-2 text-xs text-foreground/90">
            <span className="font-semibold text-emerald">Stronger concept: </span>
            {analysis.improvedConcept}
          </div>
        </div>
      </div>
    </div>
  )
}
