/**
 * Shared types for the SERP (Search Engine Results Page) rank tracker.
 *
 * Conceptually: a TrackedGig owns N TrackedKeyword rows; each TrackedKeyword
 * has many SerpSnapshot rows (one per check) that record the gig's position
 * for that keyword over time.
 */

export interface TrackedKeyword {
  id: string
  trackedGigId: string
  keyword: string
  searchUrl: string
  createdAt: string
}

export interface SerpCompetitor {
  url: string
  title: string
  position: number
  price: number | null
}

export interface SerpSnapshot {
  id: string
  trackedKeywordId: string
  checkedAt: string
  /** 1-based position in the scanned SERP, or null if not found. */
  position: number | null
  /** True when the gig wasn't seen in the scanned window. */
  notFound: boolean
  resultsScanned: number
  /** Up to 5 competitors above the user (or top 5 overall when notFound). */
  competitors: SerpCompetitor[]
}

/** A keyword + its newest snapshot, returned by the list endpoint. */
export interface TrackedKeywordWithLatest {
  keyword: TrackedKeyword
  latest: SerpSnapshot | null
  /** Position delta vs the previous snapshot — `null` means no prior data. */
  previousPosition: number | null
}

export interface AddKeywordRequest {
  keyword: string
}

export interface AddKeywordResponse {
  keyword: TrackedKeyword
  snapshot: SerpSnapshot | null
  warning?: string
}

export interface ListKeywordsResponse {
  items: TrackedKeywordWithLatest[]
}

export interface KeywordHistoryResponse {
  keyword: TrackedKeyword
  snapshots: SerpSnapshot[]
}

export interface KeywordRefreshResponse {
  snapshot: SerpSnapshot
}
