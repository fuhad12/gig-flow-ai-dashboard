/**
 * Curated list of Fiverr niches we track for competitor intelligence.
 *
 * Each niche has:
 *   - `searchUrl`: the Fiverr search/category page we scrape to harvest the
 *     top gigs. Mix of category browse pages and free-text search queries —
 *     both render the same style of gig cards on the Fiverr SPA.
 *   - `trendingTerms` (optional): a small seed list of tools/styles/keywords
 *     buyers in this niche typically search for. Used by the LLM prompts as
 *     a fallback when no fresh scrape is available — when a scrape IS
 *     available, the live `keywords` field from the snapshot takes priority
 *     and these are just a tiebreaker.
 *   - `transactionalExample` (optional): a single buyer-search phrase used
 *     as an example in the keyword-enrichment prompt. Keeps the example
 *     relevant to the niche the user is actually in.
 *
 * The list is intentionally broad — Fiverr's biggest categories (logo
 * design, video editing, voiceover, writing, social media) dwarf the
 * dev verticals in seller count, and the analyzer/generator/tracker
 * machinery is fully category-agnostic.
 */
export interface NicheDef {
  slug: string
  name: string
  searchUrl: string
  /** Short list of tools / styles / sub-keywords commonly used in this niche. */
  trendingTerms?: string[]
  /** One buyer-search phrase used as the "transactional" example in prompts. */
  transactionalExample?: string
}

export const NICHES: NicheDef[] = [
  // ---------- Programming & Tech ----------
  {
    slug: "ai-apps",
    name: "AI Apps",
    searchUrl: "https://www.fiverr.com/search/gigs?query=ai+app+development",
    trendingTerms: [
      "OpenAI",
      "LangChain",
      "RAG",
      "Cursor",
      "Lovable",
      "n8n",
      "automation",
      "AI agent",
    ],
    transactionalExample: "ai app developer",
  },
  {
    slug: "web-development",
    name: "Web Development",
    searchUrl: "https://www.fiverr.com/search/gigs?query=nextjs+saas",
    trendingTerms: [
      "Next.js",
      "Supabase",
      "Stripe",
      "Tailwind",
      "SaaS",
      "Shopify",
      "Webflow",
      "Wordpress",
    ],
    transactionalExample: "next.js developer",
  },
  {
    slug: "no-code",
    name: "No-Code MVPs",
    searchUrl: "https://www.fiverr.com/search/gigs?query=no+code+mvp",
    trendingTerms: ["Bubble", "Webflow", "Lovable", "Glide", "Softr", "Airtable"],
    transactionalExample: "no code developer",
  },
  {
    slug: "mobile-apps",
    name: "Mobile Apps",
    searchUrl: "https://www.fiverr.com/search/gigs?query=react+native+app",
    trendingTerms: [
      "React Native",
      "Flutter",
      "Expo",
      "iOS",
      "Android",
      "Firebase",
    ],
    transactionalExample: "react native app developer",
  },
  {
    slug: "data-science",
    name: "Data Science",
    searchUrl: "https://www.fiverr.com/search/gigs?query=langchain+rag",
    trendingTerms: [
      "Python",
      "Pandas",
      "LangChain",
      "RAG",
      "PyTorch",
      "Power BI",
      "Tableau",
    ],
    transactionalExample: "data scientist",
  },

  // ---------- Design ----------
  {
    slug: "logo-design",
    name: "Logo Design",
    searchUrl: "https://www.fiverr.com/categories/graphics-design/creative-logo-design",
    trendingTerms: [
      "minimalist",
      "vector",
      "mascot",
      "brand identity",
      "wordmark",
      "Procreate",
      "Adobe Illustrator",
    ],
    transactionalExample: "minimalist logo designer",
  },
  {
    slug: "ui-ux",
    name: "UI/UX Design",
    searchUrl: "https://www.fiverr.com/search/gigs?query=figma+ui+design",
    trendingTerms: ["Figma", "Framer", "wireframe", "design system", "SaaS UI", "mobile UI"],
    transactionalExample: "figma ui designer",
  },
  {
    slug: "illustration",
    name: "Illustration",
    searchUrl: "https://www.fiverr.com/search/gigs?query=digital+illustration",
    trendingTerms: [
      "digital illustration",
      "character design",
      "Procreate",
      "anime",
      "manga",
      "children's book",
    ],
    transactionalExample: "digital illustrator",
  },

  // ---------- Video & Audio ----------
  {
    slug: "video-editing",
    name: "Video Editing",
    searchUrl: "https://www.fiverr.com/search/gigs?query=video+editing",
    trendingTerms: [
      "Premiere Pro",
      "DaVinci Resolve",
      "CapCut",
      "After Effects",
      "YouTube",
      "reels",
      "TikTok",
      "short form",
    ],
    transactionalExample: "youtube video editor",
  },
  {
    slug: "voiceover",
    name: "Voiceover",
    searchUrl: "https://www.fiverr.com/search/gigs?query=voice+over",
    trendingTerms: [
      "commercial",
      "e-learning",
      "IVR",
      "explainer",
      "narration",
      "audiobook",
      "American accent",
      "British accent",
    ],
    transactionalExample: "english voice over artist",
  },

  // ---------- Writing ----------
  {
    slug: "content-writing",
    name: "Content Writing",
    searchUrl: "https://www.fiverr.com/search/gigs?query=content+writing",
    trendingTerms: [
      "SEO articles",
      "blog posts",
      "long-form",
      "thought leadership",
      "ghostwriting",
      "humanized AI",
    ],
    transactionalExample: "seo content writer",
  },
  {
    slug: "copywriting",
    name: "Copywriting",
    searchUrl: "https://www.fiverr.com/search/gigs?query=copywriting",
    trendingTerms: [
      "sales page",
      "email sequence",
      "landing page",
      "direct response",
      "Klaviyo",
      "high-converting",
    ],
    transactionalExample: "sales copywriter",
  },
  {
    slug: "translation",
    name: "Translation",
    searchUrl: "https://www.fiverr.com/search/gigs?query=translation",
    trendingTerms: [
      "native speaker",
      "certified",
      "Spanish",
      "French",
      "German",
      "Mandarin",
      "Arabic",
      "Portuguese",
    ],
    transactionalExample: "english to spanish translator",
  },

  // ---------- Marketing ----------
  {
    slug: "seo",
    name: "SEO",
    searchUrl: "https://www.fiverr.com/search/gigs?query=seo",
    trendingTerms: [
      "on-page SEO",
      "technical SEO",
      "backlinks",
      "Ahrefs",
      "SEMrush",
      "Google Search Console",
      "local SEO",
    ],
    transactionalExample: "seo expert",
  },
  {
    slug: "social-media",
    name: "Social Media Marketing",
    searchUrl: "https://www.fiverr.com/search/gigs?query=social+media+marketing",
    trendingTerms: [
      "Instagram",
      "TikTok",
      "LinkedIn",
      "content calendar",
      "Canva",
      "carousel posts",
      "Reels strategy",
    ],
    transactionalExample: "social media manager",
  },

  // ---------- Business ----------
  {
    slug: "virtual-assistant",
    name: "Virtual Assistant",
    searchUrl: "https://www.fiverr.com/search/gigs?query=virtual+assistant",
    trendingTerms: [
      "executive assistant",
      "lead generation",
      "data entry",
      "calendar management",
      "ClickUp",
      "Notion",
    ],
    transactionalExample: "executive virtual assistant",
  },
]

export function getNiche(slug: string): NicheDef | undefined {
  return NICHES.find((n) => n.slug === slug)
}

export const DEFAULT_NICHE_SLUG = NICHES[0].slug

/**
 * Format a niche's trending terms as a comma-separated string for use
 * inside an LLM prompt. Returns an empty string when the niche has none.
 */
export function renderTrendingTerms(slug: string): string {
  const niche = getNiche(slug)
  const terms = niche?.trendingTerms
  if (!terms || terms.length === 0) return ""
  return terms.join(", ")
}

// ---------- Custom (user-defined) niches ----------
//
// Fiverr has hundreds of niches; the curated catalog above covers the most
// common ones. Users in long-tail niches (tarot reading, resume writing,
// wedding planning, pet portraits, …) can register their own via the
// Settings page. Custom niches are stored as plain slugs in the same
// `selected_niches` array — there's no schema difference, just no entry
// in `NICHES`.
//
// Downstream consumers that need a friendly name should call
// `getNicheDisplayName(slug)` — it returns the catalog name when known
// and falls back to a Title-Cased version of the slug otherwise.
// Downstream consumers that need scrape config (`searchUrl`, etc.) should
// keep using `getNiche()` and treat `undefined` as "custom, skip scrape".

/**
 * Strict regex used to validate niche slugs both client- and server-side.
 *
 *   - lowercase a-z, digits, and single hyphens only
 *   - must start and end with an alphanumeric (no leading/trailing hyphens)
 *   - 2–40 characters long
 *
 * Anything that passes this regex is a legal slug. Predefined catalog
 * slugs are a strict subset of this set.
 */
export const NICHE_SLUG_REGEX =
  /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,39}$/

/**
 * Convert a free-text niche name ("Tarot Reading", "Resume Writing",
 * "iOS App Dev") into a valid slug ("tarot-reading", "resume-writing",
 * "ios-app-dev"). Returns an empty string when no usable characters are
 * left after normalization — callers should treat that as invalid.
 *
 * The transformation is deliberately conservative: accent stripping,
 * lowercase, drop punctuation, collapse whitespace+hyphen runs to a
 * single hyphen, trim leading/trailing hyphens, hard-cap at 40 chars.
 */
export function slugifyNiche(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "")
  // The slice may have landed in the middle of a "-x" suffix, leaving a
  // dangling hyphen — strip again to be safe.
  return cleaned
}

/**
 * Return `true` when `slug` is not in the predefined catalog. Used to
 * decide whether to display a "Custom" badge, whether to allow trends
 * scraping, etc.
 */
export function isCustomNiche(slug: string): boolean {
  return getNiche(slug) === undefined
}

/**
 * Human-readable display name for a niche slug. Falls back to a
 * Title-Cased version of the slug when it isn't in the catalog, so
 * "tarot-reading" renders as "Tarot Reading" everywhere — chips, AI
 * prompts, sidebar labels.
 */
export function getNicheDisplayName(slug: string): string {
  const def = getNiche(slug)
  if (def) return def.name
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}
