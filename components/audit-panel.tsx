"use client"

import { useState } from "react"
import { Switch } from "@/components/ui/switch"
import { AlertTriangle, Flame, TrendingDown } from "lucide-react"
import { ThumbnailCard } from "@/components/thumbnail-card"
import type { ThumbnailAnalysis } from "@/lib/analysis-types"

interface AuditPanelProps {
  seoCritiques: string[]
  roastComments: string[]
  /**
   * Optional thumbnail analysis to render at the top of this column.
   * It used to live in its own band above the split panels — moving
   * it inside the audit column keeps the right-hand optimization
   * panel from being squeezed off-screen when the thumbnail card is
   * tall, and lets the page-level scroll handle long content.
   */
  thumbnailUrl?: string | null
  thumbnailAnalysis?: ThumbnailAnalysis | null
}

export function AuditPanel({
  seoCritiques,
  roastComments,
  thumbnailUrl,
  thumbnailAnalysis,
}: AuditPanelProps) {
  const [roastMode, setRoastMode] = useState(false)

  const items = roastMode ? roastComments : seoCritiques
  const Icon = roastMode ? Flame : TrendingDown
  const iconColor = roastMode ? "text-danger" : "text-warning"
  const heading = roastMode
    ? "Brutally Honest Roast"
    : "SEO & Conversion Critiques"

  // This panel no longer owns a scroll container. Its parent page
  // scrolls vertically; we just render the audit content in natural
  // height. The page's top summary bar is the sticky element — this
  // header simply renders at the top of its column.
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">The Audit & Roast</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {roastMode ? "Brutally Honest" : "Professional"}
          </span>
          <Switch
            checked={roastMode}
            onCheckedChange={setRoastMode}
            className="data-[state=checked]:bg-danger"
          />
        </div>
      </div>

      {thumbnailUrl && thumbnailAnalysis && (
        <ThumbnailCard
          thumbnailUrl={thumbnailUrl}
          analysis={thumbnailAnalysis}
        />
      )}
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className={`size-4 ${iconColor}`} />
          {heading}
        </div>

        {items.length === 0 ? (
          <div className="rounded-md border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
            No critiques available.
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {items.map((text, i) => (
              <li
                key={i}
                className="rounded-md border border-border bg-card p-3 transition-colors hover:border-border/80"
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">
                    {i + 1}
                  </div>
                  <p className="text-sm leading-relaxed text-foreground">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {!roastMode && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald/20 bg-emerald/5 p-3 text-xs text-emerald/90">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Toggle <span className="font-semibold">Brutally Honest</span>{" "}
              mode above to hear what your gig really looks like to a buyer.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
