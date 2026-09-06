/**
 * Dynamic OG image for shared audits at `/audit/<slug>`.
 *
 * Next.js's file convention (`opengraph-image.tsx`) generates a
 * PNG at request time and wires it into the route's `openGraph.images`
 * and `twitter.images` automatically — no extra metadata plumbing
 * required. Social unfurlers (Slack, X, LinkedIn, Discord) call the
 * resulting URL and cache the image.
 *
 * The image surfaces the user's Gig Health Score in big numerals plus
 * the audited gig's title, branded as JobFlow AI. Concrete numbers
 * drive far more click-throughs than generic marketing cards.
 */

import { ImageResponse } from "next/og"

import { getSharedAnalysis } from "@/lib/sharing"

export const runtime = "nodejs"
// Recommended OG dimensions (Slack/X/LinkedIn all show this 1.91:1).
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const alt = "JobFlow AI · Fiverr & Upwork"

type Props = { params: Promise<{ slug: string }> }

function scoreTone(score: number): { fg: string; bg: string; label: string } {
  if (score >= 75)
    return { fg: "#34d399", bg: "rgba(52, 211, 153, 0.12)", label: "Strong" }
  if (score >= 50)
    return { fg: "#fbbf24", bg: "rgba(251, 191, 36, 0.12)", label: "Mixed" }
  return { fg: "#f87171", bg: "rgba(248, 113, 113, 0.12)", label: "Needs work" }
}

export default async function Image({ params }: Props) {
  const { slug } = await params
  const audit = await getSharedAnalysis(slug)

  // Fallback card for stale / unshared / not-found slugs. Returning an
  // image instead of erroring keeps unfurlers happy.
  if (!audit) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            background: "#0b0f14",
            color: "#e5e7eb",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: -1,
              marginBottom: 12,
            }}
          >
            JobFlow AI
          </div>
          <div style={{ fontSize: 28, color: "#9ca3af" }}>
            AI for Fiverr gigs & Upwork proposals
          </div>
        </div>
      ),
      size,
    )
  }

  const score = Math.round(audit.analysis.optimizationScore)
  const tone = scoreTone(score)
  const titleClipped =
    audit.scraped.title.length > 90
      ? `${audit.scraped.title.slice(0, 90)}…`
      : audit.scraped.title
  const trust = Math.round(audit.analysis.buyerTrustScore)
  const ctr = Math.round(audit.analysis.clickabilityPercentage)
  const ranking = audit.analysis.rankingPotential

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0b0f14",
          color: "#e5e7eb",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: 64,
        }}
      >
        {/* Brand strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#062018",
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            G
          </div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>JobFlow AI</div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: 18,
              color: "#9ca3af",
              padding: "6px 12px",
              border: "1px solid #1f2937",
              borderRadius: 999,
            }}
          >
            Fiverr SEO + Conversion Audit
          </div>
        </div>

        {/* Body: score on the left, gig info on the right */}
        <div style={{ display: "flex", flex: 1, gap: 56, alignItems: "center" }}>
          {/* Score circle */}
          <div
            style={{
              width: 280,
              height: 280,
              borderRadius: 999,
              background: tone.bg,
              border: `4px solid ${tone.fg}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 128,
                fontWeight: 800,
                color: tone.fg,
                lineHeight: 1,
              }}
            >
              {score}
            </div>
            <div
              style={{
                fontSize: 22,
                color: "#9ca3af",
                marginTop: 4,
                textTransform: "uppercase",
                letterSpacing: 2,
              }}
            >
              / 100
            </div>
          </div>

          {/* Right side */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                fontSize: 22,
                color: tone.fg,
                fontWeight: 600,
                marginBottom: 14,
                textTransform: "uppercase",
                letterSpacing: 2,
              }}
            >
              {tone.label} · Gig Health Score
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 700,
                lineHeight: 1.2,
                marginBottom: 28,
                color: "#f9fafb",
              }}
            >
              {titleClipped}
            </div>
            <div style={{ display: "flex", gap: 18 }}>
              <Stat label="Ranking" value={ranking} />
              <Stat label="Buyer trust" value={`${trust}%`} />
              <Stat label="Click-ability" value={`${ctr}%`} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 32,
            fontSize: 20,
            color: "#9ca3af",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Fiverr ranking + Upwork proposals</span>
          <span style={{ color: "#10b981", fontWeight: 600 }}>
            Audit your own gig free →
          </span>
        </div>
      </div>
    ),
    size,
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "14px 22px",
        border: "1px solid #1f2937",
        borderRadius: 14,
        background: "#0f1722",
      }}
    >
      <div
        style={{
          fontSize: 14,
          color: "#9ca3af",
          textTransform: "uppercase",
          letterSpacing: 1.5,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#f9fafb" }}>
        {value}
      </div>
    </div>
  )
}
