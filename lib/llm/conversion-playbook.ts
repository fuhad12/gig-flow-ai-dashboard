/**
 * Conversion playbook distilled from freelancers who consistently win
 * Upwork interviews and Fiverr orders (proposal coaches, top-seller
 * YouTube/TikTok breakdowns, Reddit r/Upwork / r/fiverr, Quora threads).
 *
 * Injected into JobFlow LLM system prompts so copy is client-friendly
 * and built to convert — not generic generative filler.
 */

/** Phrases that read as AI / template spam and tank reply & order rates. */
export const BANNED_FLUFF = [
  "I am writing to express my interest",
  "Dear Hiring Manager",
  "I am a passionate",
  "hardworking professional",
  "leverage my expertise",
  "seamless experience",
  "delve into",
  "synergy",
  "cutting-edge solutions",
  "I would love the opportunity",
  "looking forward to hearing from you",
  "as an AI",
  "Hi, I am a freelancer with X years",
  "guaranteed ranking",
  "100% satisfaction guaranteed results",
].join("; ")

/**
 * Upwork proposal rules — Hook → Plan → Proof → Logistics → choice CTA.
 * Sources: GigRadar / Zenlance 2026 cover-letter systems, Remogrid
 * under-200-word format, TypingEngine 5-part formula, DEV Community
 * personalization rules.
 */
export const UPWORK_WINNING_RULES = [
  "MISSION: Win an interview. Every sentence must reduce client risk or prove fit. Never write filler.",
  "",
  "STRUCTURE (paste-ready proposal, 120-200 words — mobile skim wins):",
  "1. HOOK (1-2 sentences): Reference TWO specific details from THIS job post (tool, deadline, outcome, constraint, industry). Prove you read it. Never open with yourself.",
  "2. UNDERSTANDING (1 sentence): Restate their real problem / success criteria in their words.",
  "3. MICRO-MILESTONE (2-3 sentences): Propose a small first step with clear acceptance criteria using the pattern: Done = [concrete result in client's language]. Example: Done = homepage wireframe approved in Figma + 3 screen notes.",
  "4. ONE PROOF (1-2 sentences): One relevant result with a metric if the freelancer provided experience. If no proof was given, use a honest capability claim + offer a tiny unpaid sample — NEVER invent company names, clients, or fake numbers.",
  "5. LOGISTICS (optional 1 sentence): Availability / timezone overlap / tools only if relevant.",
  "6. CHOICE CTA (1 sentence): End with a low-friction binary choice, e.g. Prefer a 10-min call, or I can send a 2-slide plan today?",
  "",
  "VOICE:",
  "- Peer-to-peer professional. Warm, clear, confident — not salesy, not desperate, not academic.",
  "- Short paragraphs (1-3 sentences). Max 3 bullets if listing deliverables.",
  "- Metrics beat adjectives (cut organic traffic 40% → not 'highly effective SEO').",
  "- Mirror the client's vocabulary from the job post.",
  `- NEVER use these fluff openers / AI tells: ${BANNED_FLUFF}.`,
  "- No markdown headings. Plain text that pastes cleanly into Upwork.",
  "",
  "CUSTOMIZE CHECKLIST: List only things the seller must fill (portfolio URL, exact metric, name) before sending — never optional fluff.",
  "WIN ANGLES: Frame as why the CLIENT wins (risk reduced, faster Done=, clearer fit) — not why the freelancer is talented.",
].join("\n")

/**
 * Fiverr listing conversion rules — buyer-first copy that still ranks.
 * Sources: EduEarnHub / Gerald / Waco3 / Zenlance gig-description systems
 * (hook → credibility → deliverables → process → CTA; outcome titles).
 */
export const FIVERR_WINNING_RULES = [
  "MISSION: Get the click AND the order. Ranking without conversion is wasted impressions.",
  "",
  "BUYER PSYCHOLOGY (always):",
  "- Write for the buyer scanning on mobile in 5 seconds. Lead with THEIR outcome, never your bio.",
  "- Never open description with 'Hi, I am…' or years-of-experience as sentence one.",
  "- Answer the buyer's silent questions: What do I get? Why you? How long? What do you need from me? What happens after I order?",
  `- Ban AI/template tells: ${BANNED_FLUFF}.`,
  "",
  "TITLE FORMULA:",
  "- Prefer: action + specific deliverable + buyer outcome (e.g. 'I will edit YouTube videos that hold watch time').",
  "- Include the primary keyword once near the front — never a pipe-separated keyword dump.",
  "",
  "DESCRIPTION STRUCTURE (plain text, short paragraphs; bullets OK as '- ' lines):",
  "1. HOOK (first 1-2 sentences): Buyer problem + clear solution. Primary keyword appears naturally in the first sentence.",
  "2. CREDIBILITY (1-2 sentences): One concrete trust signal (years, niche focus, tool mastery, volume shipped) — specific, not vague.",
  "3. DELIVERABLES: Scannable list of what the buyer receives (files, formats, revisions, extras). Reduce order-form friction.",
  "4. PROCESS: 2-4 steps of how you work (align → draft → revise → deliver).",
  "5. WHAT I NEED FROM YOU: Brief inputs required to start (reduces back-and-forth).",
  "6. CTA (last line): Direct, calm, low-pressure — and a natural primary-keyword mention if you still need one of the 3 target hits.",
  "",
  "KEYWORD RULE (2026 consensus): Exact primary keyword 2–4× in the description (hook + body + CTA). Use semantic variants for the rest. Stuffing (≥7×) hurts ranking and conversion.",
  "PACKAGES: Name outcomes, not just 'Basic/Standard/Premium'. Premium must justify the jump with a clear business result (speed, volume, strategy, rights).",
  "FAQs: Kill pre-order messages — formats, revisions, source files, commercial use, turnaround, rush fees. Buyers who find answers order more often.",
  "REQUIREMENTS: Ask only for info that unblocks delivery — never vague 'tell me about your project'.",
].join("\n")

/**
 * Fiverr seller profile (not gig listing) — title + description + skills.
 * Buyers judge the seller page before ordering from a gig.
 */
export const FIVERR_PROFILE_RULES = [
  "MISSION: Make the Fiverr seller profile look trustworthy and specific so buyers click a gig and order.",
  "",
  "HEADLINE / PROFESSIONAL TITLE:",
  "- Outcome + specialty, not 'Freelancer' or 'I do everything'.",
  "- Example: 'Minimalist logo designer for SaaS startups' — not 'Graphic Designer | Logo | Branding | …'.",
  "",
  "OVERVIEW / DESCRIPTION:",
  "- Buyer-first: who you help + what outcome + how you work + proof.",
  "- Short paragraphs. No 'Hi I am passionate'. No keyword stuffing.",
  "- Mention niches and tools buyers recognize. Invite them to view your gigs / send a brief.",
  "",
  "SKILLS:",
  "- Specific, searchable labels buyers use on Fiverr (tools, styles, deliverables).",
  "- Prefer 6-12 crisp skills; drop vague ones like 'hard work' or 'communication'.",
  "",
  `- Ban fluff: ${BANNED_FLUFF}.`,
  "Never invent clients, ratings, or metrics not present in the pasted profile.",
].join("\n")

/**
 * Upwork freelancer profile — title + overview + skills that win invites.
 */
export const UPWORK_PROFILE_RULES = [
  "MISSION: Make the Upwork profile win profile views → invites → interviews.",
  "",
  "TITLE (headline):",
  "- Specialization + outcome. Example: 'Next.js SaaS developer | MVPs that ship in 2 weeks'.",
  "- Avoid laundry-list pipes of every skill.",
  "",
  "OVERVIEW:",
  "- Lead with who you help and a concrete result (metric if provided).",
  "- 3 short sections max: specialty, how you work / process, proof + soft CTA.",
  "- Write for clients scanning on mobile. Peer tone — not a resume dump.",
  "",
  "SKILLS:",
  "- Match Upwork skill taxonomy style: concrete tools and services clients search.",
  "- Prioritize skills that match the offer; drop soft skills unless they are differentiators.",
  "",
  `- Ban fluff: ${BANNED_FLUFF}.`,
  "Never invent Job Success %, earnings, or client names not in the pasted text.",
].join("\n")
