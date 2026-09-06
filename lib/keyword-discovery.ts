/**
 * Long-tail keyword discovery from a niche scrape.
 *
 * The trends pipeline already collects the top-N gigs per niche and stores
 * them in `niche_gigs`. This module crunches that data into actionable
 * keyword candidates by:
 *
 *   1. Tokenising every gig title.
 *   2. Counting 1-grams, 2-grams, and 3-grams across the niche.
 *   3. Comparing each phrase's prevalence in the TOP-10 gigs vs the FULL
 *      sample, producing an "opportunity score":
 *          opportunity = (full% - top%) × log(1 + sample_size)
 *
 *      Phrases that show up across the full sample but not in the top
 *      gigs are the most interesting — they're niche-relevant searches
 *      whose ranking competition is weak.
 *   4. Filtering out gibberish, stopwords, and brand noise.
 *
 * No LLM is required for the base candidates; LLM enrichment (intent +
 * difficulty + headline) happens in the API route.
 */

import type { NicheGig } from "@/lib/trends"

/** Tone-coded opportunity classification used by the UI. */
export type OpportunityTier = "high" | "medium" | "low" | "saturated"

export interface KeywordCandidate {
  phrase: string
  ngram: 1 | 2 | 3
  fullCount: number
  fullPct: number
  topCount: number
  topPct: number
  /** -1..+∞ (capped 0 in the UI). Bigger = juicier. */
  opportunity: number
  tier: OpportunityTier
}

export interface DiscoveryResult {
  niche: string
  sampleSize: number
  topSize: number
  candidates: KeywordCandidate[]
}

// ---------- Tokenisation ----------

// Reuses the same stopwords philosophy as lib/trends.ts but a little
// tighter — we want phrase-level discovery, so we keep tokens like
// "next.js" and "no-code" intact.
const STOPWORDS = new Set([
  "i", "will", "you", "your", "a", "an", "the", "and", "or", "to",
  "of", "in", "on", "for", "with", "by", "any", "my", "this", "that",
  "it", "is", "be", "do", "make", "create", "build", "design",
  "develop", "professional", "best", "amazing", "high", "quality",
  "custom", "fast", "modern", "responsive", "from", "into",
  "stunning", "perfect", "premium", "quick", "great", "expert",
  "experienced", "experts", "service", "services", "perfectly", "well",
  "really", "very", "also",
])

// Domain words that don't add ranking value on their own but are useful
// inside multi-word phrases. We keep them in n-grams but drop them when
// they're a 1-gram.
const FILLER_AS_UNIGRAM = new Set([
  "website", "websites", "web", "app", "apps", "page", "pages",
  "site", "sites", "project", "code",
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-./]+|[-./]+$/g, ""))
    .filter(
      (w) =>
        w.length >= 2 &&
        !STOPWORDS.has(w) &&
        !/^\d+$/.test(w) &&
        w !== "-",
    )
}

function phrasesOfLength(tokens: string[], n: number): string[] {
  const out: string[] = []
  for (let i = 0; i + n <= tokens.length; i++) {
    const phrase = tokens.slice(i, i + n).join(" ")
    // Drop phrases that start or end on filler — they're rarely
    // good standalone keywords (e.g. "your react app").
    if (n > 1) {
      const first = tokens[i]
      const last = tokens[i + n - 1]
      if (FILLER_AS_UNIGRAM.has(first) || FILLER_AS_UNIGRAM.has(last)) {
        continue
      }
    } else if (FILLER_AS_UNIGRAM.has(phrase)) {
      continue
    }
    out.push(phrase)
  }
  return out
}

function countPhrases(
  gigs: NicheGig[],
  n: 1 | 2 | 3,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const g of gigs) {
    const tokens = tokenize(g.title)
    // Per-gig dedup so a single repetitive title doesn't dominate.
    const seen = new Set<string>()
    for (const p of phrasesOfLength(tokens, n)) {
      if (seen.has(p)) continue
      seen.add(p)
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
  }
  return counts
}

function tier(opp: number, fullPct: number, topPct: number): OpportunityTier {
  // Saturated: ≥60% of the top-10 already use it.
  if (topPct >= 60) return "saturated"
  // Strong opportunity: meaningfully present in the niche, weak at the top.
  if (opp >= 0.25 && fullPct >= 20) return "high"
  if (opp >= 0.1 && fullPct >= 15) return "medium"
  return "low"
}

// ---------- Public API ----------

export function discoverKeywords(
  niche: string,
  gigs: NicheGig[],
  options: { topN?: number; max?: number } = {},
): DiscoveryResult {
  const topN = options.topN ?? 10
  const max = options.max ?? 30
  const sampleSize = gigs.length
  const topSize = Math.min(topN, sampleSize)
  if (sampleSize === 0) {
    return { niche, sampleSize: 0, topSize: 0, candidates: [] }
  }

  // Top gigs = the first N by position (already sorted in the snapshot
  // pipeline).
  const top = [...gigs]
    .sort((a, b) => a.position - b.position)
    .slice(0, topN)

  const sampleSizeLog = Math.log(1 + sampleSize)

  const allCandidates: KeywordCandidate[] = []

  for (const n of [1, 2, 3] as const) {
    const full = countPhrases(gigs, n)
    const tops = countPhrases(top, n)
    for (const [phrase, fullCount] of full.entries()) {
      // Require minimum prevalence to filter out noise: at least 3
      // appearances for 1-grams, 2 for 2-grams/3-grams.
      const minFull = n === 1 ? 3 : 2
      if (fullCount < minFull) continue

      const topCount = tops.get(phrase) ?? 0
      const fullPct = (fullCount / sampleSize) * 100
      const topPct = topSize ? (topCount / topSize) * 100 : 0
      // Opportunity: higher when full% > top% (long-tail signal). Use
      // ratio so log-scaled sample sizes nudge candidates with broader
      // support upward.
      const oppRaw = (fullPct - topPct) / 100
      const opportunity = oppRaw * sampleSizeLog
      const t = tier(opportunity, fullPct, topPct)
      // Trim 1-grams that are obvious — too short, or generic platform
      // names that the user already knows.
      if (n === 1 && phrase.length <= 2) continue

      allCandidates.push({
        phrase,
        ngram: n,
        fullCount,
        fullPct: round1(fullPct),
        topCount,
        topPct: round1(topPct),
        opportunity: round3(opportunity),
        tier: t,
      })
    }
  }

  // Sort by tier (high > medium > low > saturated), then by opportunity,
  // then break ties with full count.
  const tierRank: Record<OpportunityTier, number> = {
    high: 0,
    medium: 1,
    low: 2,
    saturated: 3,
  }
  allCandidates.sort((a, b) => {
    if (tierRank[a.tier] !== tierRank[b.tier]) {
      return tierRank[a.tier] - tierRank[b.tier]
    }
    if (a.opportunity !== b.opportunity) return b.opportunity - a.opportunity
    return b.fullCount - a.fullCount
  })

  // Dedup near-duplicates: if a 3-gram contains a 2-gram already in the
  // list (or vice-versa), keep only the higher-opportunity variant.
  const kept: KeywordCandidate[] = []
  const seenPhrases = new Set<string>()
  for (const cand of allCandidates) {
    if (seenPhrases.has(cand.phrase)) continue
    let dominated = false
    for (const k of kept) {
      if (
        (k.phrase.includes(cand.phrase) || cand.phrase.includes(k.phrase)) &&
        k.tier === cand.tier
      ) {
        dominated = true
        break
      }
    }
    if (dominated) continue
    kept.push(cand)
    seenPhrases.add(cand.phrase)
    if (kept.length >= max) break
  }

  return { niche, sampleSize, topSize, candidates: kept }
}

// ---------- Internals ----------

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
