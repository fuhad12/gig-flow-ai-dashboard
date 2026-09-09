/**
 * AEO / GEO / AIO visibility layer for freelancers.
 *
 * SEO = found in Fiverr/Upwork search
 * AEO = selected as the direct answer (FAQ, first line, screening Qs)
 * GEO = citable / recommendable when clients ask AI for a shortlist
 * AIO = consistent niche signals across surfaces
 */

export type VisibilityLayer = "seo" | "aeo" | "geo" | "aio"

export interface VisibilityChecklistItem {
  /** Stable key for UI grouping, e.g. `faq_block`, `proof_metric`. */
  id: string
  layer: VisibilityLayer
  /** Short action title. */
  title: string
  /** Concrete how-to for the seller. */
  detail: string
}

export interface QaPair {
  question: string
  answer: string
}

export const LAYER_LABEL: Record<VisibilityLayer, string> = {
  seo: "SEO — get found",
  aeo: "AEO — be the answer",
  geo: "GEO — get cited by AI",
  aio: "AIO — stay consistent",
}

export const LAYER_SHORT: Record<VisibilityLayer, string> = {
  seo: "SEO",
  aeo: "AEO",
  geo: "GEO",
  aio: "AIO",
}

const VALID_LAYERS: readonly VisibilityLayer[] = ["seo", "aeo", "geo", "aio"]

export function normalizeLayer(raw: string): VisibilityLayer {
  const v = raw.trim().toLowerCase()
  if ((VALID_LAYERS as readonly string[]).includes(v)) {
    return v as VisibilityLayer
  }
  return "seo"
}

export function cleanQaPairs(
  items: Array<{ question?: unknown; answer?: unknown }>,
  max = 5,
): QaPair[] {
  const out: QaPair[] = []
  for (const item of items.slice(0, max * 2)) {
    const question =
      typeof item.question === "string" ? item.question.trim() : ""
    const answer = typeof item.answer === "string" ? item.answer.trim() : ""
    if (question.length < 8 || answer.length < 12) continue
    out.push({
      question: question.slice(0, 200),
      answer: answer.slice(0, 600),
    })
    if (out.length >= max) break
  }
  return out
}

export function cleanChecklist(
  items: Array<{
    id?: unknown
    layer?: unknown
    title?: unknown
    detail?: unknown
  }>,
  fallbacks: VisibilityChecklistItem[],
  min = 4,
  max = 8,
): VisibilityChecklistItem[] {
  const out: VisibilityChecklistItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const title = typeof item.title === "string" ? item.title.trim() : ""
    const detail = typeof item.detail === "string" ? item.detail.trim() : ""
    if (title.length < 4 || detail.length < 12) continue
    const idRaw =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_")
        : title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)
    if (seen.has(idRaw)) continue
    seen.add(idRaw)
    out.push({
      id: idRaw.slice(0, 48),
      layer: normalizeLayer(
        typeof item.layer === "string" ? item.layer : "seo",
      ),
      title: title.slice(0, 100),
      detail: detail.slice(0, 320),
    })
    if (out.length >= max) break
  }
  for (const fb of fallbacks) {
    if (out.length >= min) break
    if (seen.has(fb.id)) continue
    seen.add(fb.id)
    out.push(fb)
  }
  return out.slice(0, max)
}

export function cleanProofQuotes(items: unknown[], max = 4): string[] {
  return items
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 280)
    .slice(0, max)
}

/** Default gig checklist when the model under-delivers. */
export const DEFAULT_GIG_CHECKLIST: VisibilityChecklistItem[] = [
  {
    id: "seo_keyword",
    layer: "seo",
    title: "Lock one primary keyword",
    detail:
      "Put the buyer search phrase once in the title and 2–4 times naturally in the description.",
  },
  {
    id: "aeo_hook",
    layer: "aeo",
    title: "Answer in the first sentence",
    detail:
      "Open with the buyer outcome in plain language so scanners (and answer engines) can extract it.",
  },
  {
    id: "aeo_faq",
    layer: "aeo",
    title: "Add FAQ that removes DMs",
    detail:
      "Cover formats, revisions, source files, commercial use, and turnaround so buyers order without messaging.",
  },
  {
    id: "geo_proof",
    layer: "geo",
    title: "Add one citable proof line",
    detail:
      "Include a concrete metric or niche result AI tools can quote when clients ask for a recommendation.",
  },
  {
    id: "aio_niche",
    layer: "aio",
    title: "Keep niche language consistent",
    detail:
      "Use the same specialty nouns in title, tags, FAQ, and packages — mixed signals confuse matching.",
  },
]

/** Default Upwork proposal checklist extras. */
export const DEFAULT_PROPOSAL_CHECKLIST: VisibilityChecklistItem[] = [
  {
    id: "aeo_screening",
    layer: "aeo",
    title: "Answer screening questions",
    detail:
      "Paste short, specific answers that restate their constraints — not generic capability claims.",
  },
  {
    id: "geo_recommend",
    layer: "geo",
    title: "Sound recommendable",
    detail:
      "One niche + one proof line so an AI shortlist would name you for this exact job type.",
  },
]

/** Default profile checklist. */
export const DEFAULT_PROFILE_CHECKLIST: VisibilityChecklistItem[] = [
  {
    id: "seo_headline",
    layer: "seo",
    title: "Niche headline buyers search",
    detail:
      "Lead with specialty + outcome nouns clients type into marketplace search.",
  },
  {
    id: "aeo_snippet",
    layer: "aeo",
    title: "Snippet-first overview",
    detail:
      "First 200–250 characters must answer who you help and what you deliver.",
  },
  {
    id: "geo_quote",
    layer: "geo",
    title: "Publish citable proof",
    detail:
      "Add 1–2 measurable results AI assistants can lift when clients ask for freelancers like you.",
  },
  {
    id: "aio_consistent",
    layer: "aio",
    title: "Align skills with headline",
    detail:
      "Keep title, overview, and skills in one niche so Uma / AI matching trusts the pattern.",
  },
]
