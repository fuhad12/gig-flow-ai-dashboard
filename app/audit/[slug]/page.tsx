/**
 * Public audit page rendered at `/audit/<slug>`.
 *
 * No authentication required — the row is only visible at all when its
 * `public_slug` matches what the owner shared. RLS in migration 0007
 * permits anon SELECTs on rows where public_slug is not null; we go
 * through the admin client in `getSharedAnalysis` purely for convenience.
 */

import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PublicAuditView } from "@/components/public-audit-view"
import { getSharedAnalysis } from "@/lib/sharing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params
  const audit = await getSharedAnalysis(slug)
  if (!audit) {
    return {
      title: "Audit not found · JobFlow AI",
      robots: { index: false, follow: false },
    }
  }
  const score = Math.round(audit.analysis.optimizationScore)
  const trust = Math.round(audit.analysis.buyerTrustScore)
  const ctr = Math.round(audit.analysis.clickabilityPercentage)
  const ranking = audit.analysis.rankingPotential
  const titleSummary =
    audit.scraped.title.length > 70
      ? `${audit.scraped.title.slice(0, 70)}…`
      : audit.scraped.title

  // Build a description that surfaces real numbers — social previewers
  // show this verbatim, and concrete numbers ("82/100 health") drive
  // more clicks than generic copy.
  const description = `Gig Health ${score}/100 · ${ranking} ranking potential · ${trust}% buyer trust · ${ctr}% click-ability. AI audit by JobFlow AI.`

  // Canonical URL for the share — used as the OG `url` so unfurlers
  // (Slack, Discord, LinkedIn, etc.) cache the right link.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobflow.win"
  const canonical = `${siteUrl.replace(/\/$/, "")}/audit/${slug}`

  return {
    title: `${titleSummary} — Gig Health ${score}/100 · JobFlow AI`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${titleSummary} — Gig Health ${score}/100`,
      description,
      url: canonical,
      siteName: "JobFlow AI",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${titleSummary} — Gig Health ${score}/100`,
      description,
    },
  }
}

export default async function PublicAuditPage({ params }: PageProps) {
  const { slug } = await params
  const audit = await getSharedAnalysis(slug)
  if (!audit) notFound()

  return (
    <PublicAuditView
      url={audit.url}
      scraped={audit.scraped}
      analysis={audit.analysis}
      sharedAt={audit.sharedAt}
    />
  )
}
