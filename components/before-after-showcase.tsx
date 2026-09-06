/**
 * Marketing landing — per-niche before/after demo gig section.
 *
 * Shows a side-by-side card of an "average" Fiverr gig vs the same gig after
 * JobFlow optimization, with tabs to switch between five popular Fiverr
 * categories. The goal is for a visitor in any of these niches to see their
 * own world reflected back in 2 seconds — much more persuasive than a
 * generic feature list.
 *
 * Demo data is hardcoded but realistic; numbers are illustrative and
 * deliberately conservative (no 10x miracle claims).
 *
 * Client component because the tabs need state. Rendered inline by the
 * server-component MarketingLanding.
 */

"use client"

import { useState } from "react"
import {
  ArrowRight,
  PaintBucket,
  Video,
  Mic,
  FileText,
  Code2,
  type LucideIcon,
} from "lucide-react"

interface GigSnapshot {
  title: string
  description: string
  tags: string[]
  optimizationScore: number
  clickability: number
}

interface DemoNiche {
  slug: string
  name: string
  icon: LucideIcon
  before: GigSnapshot
  after: GigSnapshot
}

const DEMOS: DemoNiche[] = [
  {
    slug: "logo-design",
    name: "Logo Design",
    icon: PaintBucket,
    before: {
      title:
        "I will design a creative and professional logo for your business",
      description:
        "Hello! I'm a logo designer with experience. I will design a creative and professional logo for you with multiple revisions until you are 100% satisfied. I work fast and deliver quality logos.",
      tags: [
        "logo design",
        "business logo",
        "creative logo",
        "professional logo",
        "custom logo",
      ],
      optimizationScore: 42,
      clickability: 31,
    },
    after: {
      title:
        "I will design a minimalist logo, minimalist brand mark, and minimalist icon",
      description:
        "I design minimalist logos for SaaS founders and DTC brands. 200+ brands shipped — from pre-seed startups to Series A. Every minimalist logo lands with a full brand mark kit (vector AI/SVG, favicon, dark/light variants). 3 minimalist concepts in 48h, unlimited revisions until you sign off. No mockups stolen from Dribbble — every minimalist mark is drawn from scratch.",
      tags: [
        "minimalist logo",
        "minimalist brand",
        "vector logo",
        "brand identity",
        "startup logo",
      ],
      optimizationScore: 87,
      clickability: 74,
    },
  },
  {
    slug: "video-editing",
    name: "Video Editing",
    icon: Video,
    before: {
      title:
        "I will be your professional video editor for any kind of video editing",
      description:
        "I am a professional video editor and I can edit any kind of video for you including YouTube, Instagram, TikTok, and more. I deliver fast and offer revisions.",
      tags: [
        "video editing",
        "video editor",
        "professional",
        "youtube",
        "editing",
      ],
      optimizationScore: 38,
      clickability: 28,
    },
    after: {
      title:
        "I will edit your reels, youtube shorts, and tiktok reels in Premiere Pro",
      description:
        "I edit short-form reels and YouTube shorts that hold attention past 3 seconds. 400+ reels shipped for creators with 100k+ followers. Each reel comes back captioned, color-graded, and beat-cut in Premiere Pro — drag, drop, post. Avg 36h turnaround, unlimited revisions on the first cut. No watermarks, no AI auto-edits, no template look.",
      tags: [
        "reels editor",
        "youtube shorts",
        "short form video",
        "premiere pro reels",
        "instagram reels",
      ],
      optimizationScore: 84,
      clickability: 71,
    },
  },
  {
    slug: "voiceover",
    name: "Voiceover",
    icon: Mic,
    before: {
      title:
        "I will be your professional voiceover artist for any project",
      description:
        "I am a professional voiceover artist and I will record a high quality voiceover for your video, commercial, or any other project you need.",
      tags: [
        "voice over",
        "voiceover",
        "professional voice",
        "voice artist",
        "american voice",
      ],
      optimizationScore: 44,
      clickability: 33,
    },
    after: {
      title:
        "I will record a warm commercial voiceover, e-learning voiceover, or audiobook voiceover",
      description:
        "I record commercial voiceovers from a broadcast-treated studio. 5 years on-air at a US regional network, 800+ commercial reads delivered for brands you've heard of. Warm, conversational American accent. Each commercial voiceover comes back as 48kHz WAV + MP3, fully de-essed and broadcast-ready. 24h turnaround on under-60-second reads, unlimited revisions on the first take.",
      tags: [
        "commercial voiceover",
        "american voiceover",
        "e-learning voiceover",
        "audiobook voiceover",
        "explainer voiceover",
      ],
      optimizationScore: 89,
      clickability: 76,
    },
  },
  {
    slug: "content-writing",
    name: "Content Writing",
    icon: FileText,
    before: {
      title: "I will write SEO content and articles for your blog",
      description:
        "I am a content writer with experience writing blog posts and SEO articles. I will write high quality content for your website that will help you rank on Google.",
      tags: [
        "content writing",
        "blog writer",
        "seo writer",
        "article writing",
        "blogger",
      ],
      optimizationScore: 40,
      clickability: 30,
    },
    after: {
      title:
        "I will write long-form seo articles, seo blog posts, and humanized seo content",
      description:
        "I write 2,000+ word SEO articles that actually rank — humanized voice, real research, zero AI tells. 350+ articles shipped for B2B SaaS clients including 7-figure ARR brands. Every seo article ships with a target keyword cluster, internal-link map, and meta description — no extra steps before publishing. Surfer SEO score 80+ on every piece, original research interviews when the brief calls for it.",
      tags: [
        "seo content writer",
        "long form seo",
        "seo article writing",
        "b2b seo content",
        "seo blog writer",
      ],
      optimizationScore: 86,
      clickability: 72,
    },
  },
  {
    slug: "web-development",
    name: "Web Development",
    icon: Code2,
    before: {
      title: "I will build a website using nextjs and react for you",
      description:
        "I am a web developer and I will build a modern website for you using Next.js, React, and other modern tools. I deliver fast and offer revisions.",
      tags: [
        "web development",
        "website",
        "nextjs",
        "react",
        "developer",
      ],
      optimizationScore: 47,
      clickability: 36,
    },
    after: {
      title:
        "I will build your nextjs SaaS app, nextjs landing page, and nextjs dashboard",
      description:
        "I ship production-ready Next.js SaaS apps with Stripe billing and Supabase auth wired in from day one. 30+ Next.js apps shipped, including 3 currently doing $10k+ MRR. Every Next.js build ships with TypeScript, Tailwind, Vercel deployment, and tests — not a localhost-only demo. Premium tier includes auth flows, billing portal, and 30 days of bug fixes post-launch.",
      tags: [
        "nextjs developer",
        "nextjs saas",
        "nextjs dashboard",
        "nextjs landing page",
        "react nextjs",
      ],
      optimizationScore: 88,
      clickability: 75,
    },
  },
]

export function BeforeAfterShowcase() {
  const [activeSlug, setActiveSlug] = useState<string>(DEMOS[0].slug)
  const active = DEMOS.find((d) => d.slug === activeSlug) ?? DEMOS[0]
  const scoreDelta = active.after.optimizationScore - active.before.optimizationScore
  const clickDelta = active.after.clickability - active.before.clickability

  return (
    <section className="bg-card/30 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            See the rewrite for your niche
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Same skill. Two Fiverr listings. The one on the right uses the
            rewrite JobFlow ships back — then open Upwork in the app when you
            need a proposal for a job post.
          </p>
        </div>

        {/* Category tabs */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {DEMOS.map((d) => {
            const Icon = d.icon
            const isActive = d.slug === activeSlug
            return (
              <button
                key={d.slug}
                type="button"
                onClick={() => setActiveSlug(d.slug)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  isActive
                    ? "border-emerald bg-emerald/15 text-emerald"
                    : "border-border bg-card text-muted-foreground hover:border-emerald/40 hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {d.name}
              </button>
            )
          })}
        </div>

        {/* Before / After cards */}
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <GigCard label="Before" tone="muted" snapshot={active.before} />
          <div className="flex items-center justify-center md:px-2">
            <div className="hidden size-10 items-center justify-center rounded-full border border-emerald/30 bg-emerald/10 md:flex">
              <ArrowRight className="size-5 text-emerald" />
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald md:hidden">
              JobFlow rewrite ↓
            </div>
          </div>
          <GigCard
            label="After JobFlow"
            tone="emerald"
            snapshot={active.after}
            scoreDelta={scoreDelta}
            clickDelta={clickDelta}
          />
        </div>

        <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted-foreground">
          Illustrative example. Real audits cite your actual gig content, niche
          competitor data, and Fiverr&apos;s current ranking signals.
        </p>
      </div>
    </section>
  )
}

interface GigCardProps {
  label: string
  tone: "muted" | "emerald"
  snapshot: GigSnapshot
  scoreDelta?: number
  clickDelta?: number
}

function GigCard({
  label,
  tone,
  snapshot,
  scoreDelta,
  clickDelta,
}: GigCardProps) {
  const ring =
    tone === "emerald"
      ? "border-emerald/40 bg-emerald/[0.03] shadow-[0_0_0_1px_var(--color-emerald)]"
      : "border-border bg-card"
  const labelBadge =
    tone === "emerald"
      ? "bg-emerald/20 text-emerald"
      : "bg-muted/30 text-muted-foreground"
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${ring}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${labelBadge}`}
        >
          {label}
        </span>
        <ScoreChip
          score={snapshot.optimizationScore}
          delta={scoreDelta}
          tone={tone}
        />
      </div>

      <h3 className="text-sm font-semibold leading-snug text-foreground sm:text-base">
        {snapshot.title}
      </h3>

      <p className="mt-3 line-clamp-5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
        {snapshot.description}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {snapshot.tags.map((t) => (
          <span
            key={t}
            className="rounded-md border border-border bg-background/50 px-2 py-0.5 text-[10px] text-foreground/80 sm:text-xs"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-4 border-t border-border pt-3 text-xs">
        <Metric
          label="Clickability"
          value={`${snapshot.clickability}%`}
          delta={clickDelta}
        />
        <Metric
          label="Optimization"
          value={`${snapshot.optimizationScore}/100`}
          delta={scoreDelta}
        />
      </div>
    </div>
  )
}

function ScoreChip({
  score,
  delta,
  tone,
}: {
  score: number
  delta?: number
  tone: "muted" | "emerald"
}) {
  if (tone === "emerald" && typeof delta === "number" && delta !== 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald/15 px-2 py-0.5 text-[10px] font-semibold text-emerald">
        +{delta} points
      </span>
    )
  }
  return (
    <span className="text-[10px] font-medium text-muted-foreground">
      Score {score}/100
    </span>
  )
}

function Metric({
  label,
  value,
  delta,
}: {
  label: string
  value: string
  delta?: number
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {value}
        {typeof delta === "number" && delta !== 0 && (
          <span className="text-[10px] font-medium text-emerald">
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        )}
      </p>
    </div>
  )
}
