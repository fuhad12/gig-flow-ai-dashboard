/**
 * Public marketing landing page rendered at `/` for unauthenticated visitors.
 *
 * Server component — no client interactivity needed. The CTAs route to
 * `/auth` (sign in or sign up), which already redirects authed users back to
 * the dashboard.
 *
 * Section order: hero → social-proof strip → feature grid → how it works →
 * pricing → final CTA → footer.
 */

import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Radar,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Wand2,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { BeforeAfterShowcase } from "@/components/before-after-showcase"
import {
  AGENCY_MONTHLY_SCAN_LIMIT,
  AGENCY_TRACKED_GIG_LIMIT,
  FREE_MONTHLY_SCAN_LIMIT,
  FREE_TRACKED_GIG_LIMIT,
  PRO_MONTHLY_SCAN_LIMIT,
  PRO_TRACKED_GIG_LIMIT,
} from "@/lib/quota"

export function MarketingLanding() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <Hero />
      <SocialProof />
      <BeforeAfterShowcase />
      <FeatureGrid />
      <HowItWorks />
      <Pricing />
      <FinalCta />
      <Footer />
    </div>
  )
}

// ---------- Sections ----------

function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald text-primary-foreground">
            <BarChart3 className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            JobFlow AI
          </span>
        </div>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <a href="#how" className="hover:text-foreground">
            How it works
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/auth"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Sign in
          </Link>
          <Button
            asChild
            size="sm"
            className="bg-emerald text-primary-foreground hover:bg-emerald/90"
          >
            <Link href="/auth?mode=signup">Start free</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-emerald/10 blur-3xl" />
      </div>
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-20 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald/30 bg-emerald/10 px-3 py-1 text-xs text-emerald">
          <Sparkles className="size-3" />
          Fiverr ranking + Upwork proposal AI
        </div>
        <h1 className="mt-6 text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Win more freelance work —
          <span className="block bg-gradient-to-r from-emerald to-emerald/60 bg-clip-text text-transparent">
            on Fiverr and Upwork.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
          Audit and rewrite Fiverr gigs that actually rank. Paste an Upwork job
          post and get a tailored proposal that sounds human — not a template.
          One AI credit pool for both platforms.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="gap-2 bg-emerald text-primary-foreground hover:bg-emerald/90"
          >
            <Link href="/auth?mode=signup">
              Start free
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="#how">See how it works</Link>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Free plan includes {FREE_MONTHLY_SCAN_LIMIT} AI credits per month. No
          credit card required.
        </p>
      </div>
    </section>
  )
}

function SocialProof() {
  const categories = [
    "Logo Design",
    "Video Editing",
    "Voiceover",
    "Content Writing",
    "Web Development",
    "Social Media",
    "SEO",
    "Illustration",
    "Translation",
  ]
  return (
    <section className="border-y border-border bg-card/30 py-6">
      <div className="mx-auto max-w-6xl px-6">
        <p className="text-center text-xs uppercase tracking-wider text-muted-foreground">
          Built for freelancers on Fiverr &amp; Upwork
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-muted-foreground">
          {categories.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureGrid() {
  const features = [
    {
      icon: Search,
      title: "Fiverr Gig Analyzer",
      copy: "Paste any Fiverr URL. AI scores ranking potential, buyer trust, click-ability, and shows exactly what's blocking orders.",
    },
    {
      icon: Briefcase,
      title: "Upwork Proposal Writer",
      copy: "Paste a job post. Get a short, specific proposal with a hook, bid hint, and fit score — tailored to your skills, not a generic template.",
    },
    {
      icon: Wand2,
      title: "AI Gig Generator",
      copy: "Drop your skill + tools. Get a full Fiverr-ready listing (title, description, tags, FAQs, packages) built around real niche demand.",
    },
    {
      icon: Target,
      title: "Conversion Prediction",
      copy: "Forecast monthly impressions, clicks, and orders before you publish. See which lever moves the needle most.",
    },
    {
      icon: Radar,
      title: "Competitor Tracker",
      copy: "Watch competitor Fiverr gigs and get notified when they tweak prices, titles, or tags.",
    },
    {
      icon: TrendingUp,
      title: "Niche Intelligence",
      copy: "See what's actually trending — top keywords, price brackets, opportunity gaps — for your niches.",
    },
  ]
  return (
    <section id="features" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Two platforms. One workflow.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Rank and convert on Fiverr. Win interviews on Upwork. JobFlow gives
            you the copy and the diagnosis — without bouncing between tools.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-emerald/50"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald/10">
                <f.icon className="size-5 text-emerald" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.copy}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    {
      icon: ClipboardList,
      title: "Paste a Fiverr URL or Upwork job",
      copy: "Drop in a live Fiverr gig link, or paste an Upwork job post. JobFlow works from the text you give it — no browser extension required.",
    },
    {
      icon: Zap,
      title: "Get the diagnosis (or the proposal)",
      copy: "Fiverr: ranking score, trust signals, and what&apos;s blocking orders. Upwork: a short, specific proposal with a hook, bid hint, and fit score.",
    },
    {
      icon: Sparkles,
      title: "Paste and ship",
      copy: "Copy optimized Fiverr title, description, and tags — or send the Upwork proposal. One AI credit pool powers both.",
    },
  ]
  return (
    <section id="how" className="bg-card/30 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            From paste to publish in three steps
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Rank on Fiverr. Win interviews on Upwork. Same app, same credit pool.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.title}
              className="relative rounded-xl border border-border bg-card p-6"
            >
              <div className="absolute -top-3 left-6 inline-flex size-7 items-center justify-center rounded-full bg-emerald text-xs font-bold text-primary-foreground">
                {i + 1}
              </div>
              <div className="mt-2 flex size-10 items-center justify-center rounded-lg bg-emerald/10">
                <s.icon className="size-5 text-emerald" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.copy}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Pricing() {
  const tiers: {
    name: string
    price: string
    cadence: string
    cta: string
    href: string
    highlight?: boolean
    bullets: string[]
  }[] = [
    {
      name: "Free",
      price: "$0",
      cadence: "forever",
      cta: "Start free",
      href: "/auth?mode=signup",
      bullets: [
        `${FREE_MONTHLY_SCAN_LIMIT} AI credits per month`,
        "Fiverr audits + Upwork proposals",
        "AI gig generator",
        "Niche trends &amp; pricing intel",
        `${FREE_TRACKED_GIG_LIMIT} tracked competitor gig`,
      ],
    },
    {
      name: "Pro",
      price: "$12",
      cadence: "per month · or $108/yr (save 25%)",
      cta: "Go Pro",
      href: "/auth?mode=signup&plan=pro-monthly",
      highlight: true,
      bullets: [
        `${PRO_MONTHLY_SCAN_LIMIT} AI credits per month`,
        "Fiverr audits, generations &amp; Upwork proposals",
        "Trend &amp; keyword intelligence",
        `Up to ${PRO_TRACKED_GIG_LIMIT} tracked competitors with auto-refresh`,
        "Top up anytime if you spike past your cap",
      ],
    },
    {
      name: "Agency",
      price: "$29.99",
      cadence: "per month · or $269.99/yr (save 25%)",
      cta: "Go Agency",
      href: "/auth?mode=signup&plan=agency-monthly",
      bullets: [
        `${AGENCY_MONTHLY_SCAN_LIMIT} AI credits per month`,
        "Everything in Pro",
        `Up to ${AGENCY_TRACKED_GIG_LIMIT} tracked competitor gigs`,
        "Side-by-side gig comparisons",
        "Priority AI processing",
      ],
    },
  ]
  return (
    <section id="pricing" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Pricing that pays for itself in one win
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            One extra Fiverr order — or one Upwork contract — covers a year of
            Pro. Credits work across both platforms.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`rounded-xl border p-6 ${
                t.highlight
                  ? "border-emerald bg-emerald/5 shadow-[0_0_0_1px_var(--color-emerald)]"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <h3 className="text-lg font-semibold">{t.name}</h3>
                {t.highlight && (
                  <span className="rounded-full bg-emerald/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald">
                    Most popular
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold">{t.price}</span>
                <span
                  className="text-sm text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: t.cadence }}
                />
              </div>
              <ul className="mt-6 space-y-2">
                {t.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-sm text-foreground/90"
                  >
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald" />
                    <span dangerouslySetInnerHTML={{ __html: b }} />
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className={`mt-6 w-full ${
                  t.highlight
                    ? "bg-emerald text-primary-foreground hover:bg-emerald/90"
                    : ""
                }`}
                variant={t.highlight ? "default" : "outline"}
              >
                <Link href={t.href}>{t.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-border bg-card/40 py-20">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald/10 blur-3xl" />
      </div>
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Rank on Fiverr. Win on Upwork.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Audit a gig or write a proposal in under a minute. Try it free — no
          card required.
        </p>
        <Button
          asChild
          size="lg"
          className="mt-8 gap-2 bg-emerald text-primary-foreground hover:bg-emerald/90"
        >
          <Link href="/auth?mode=signup">
            Start free
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-border py-8 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 md:flex-row">
        <div className="flex items-center gap-2">
          <div className="flex size-5 items-center justify-center rounded bg-emerald text-primary-foreground">
            <BarChart3 className="size-3" />
          </div>
          <span className="font-medium text-foreground">JobFlow AI</span>
          <span className="text-xs">
            © {new Date().getFullYear()}
          </span>
        </div>
        <div className="flex items-center gap-5 text-xs">
          <Link href="/auth" className="hover:text-foreground">
            Sign in
          </Link>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
          <span>Not affiliated with Fiverr Inc. or Upwork Global Inc.</span>
        </div>
      </div>
    </footer>
  )
}
