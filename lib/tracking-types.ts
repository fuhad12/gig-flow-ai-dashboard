/**
 * Shared types for gig tracking.
 */

import type { ScrapedGig } from "@/lib/analysis-types"

export interface TrackedGig {
  id: string
  url: string
  nickname: string | null
  createdAt: string
}

/** Subset of `ScrapedGig` plus a few denormalized stats. */
export interface TrackedGigSnapshot {
  id: string
  trackedGigId: string
  scrapedAt: string
  title: string
  description: string
  thumbnailUrl: string | null
  tags: string[]
  packages: ScrapedGig["packages"]
  minPrice: number | null
  maxPrice: number | null
  searchKeyword: string | null
  searchPosition: number | null
}

/** A tracked gig joined with its latest snapshot, for the list view. */
export interface TrackedGigWithLatest {
  gig: TrackedGig
  latest: TrackedGigSnapshot | null
}

/** A high-level diff between two snapshots, used in the change log. */
export type ChangeKind =
  | "title"
  | "description"
  | "thumbnail"
  | "tags"
  | "packages"
  | "price-min"
  | "price-max"

export interface SnapshotChange {
  kind: ChangeKind
  description: string
  /** Optional numeric delta where it makes sense (e.g. price changes). */
  delta?: number
}

export interface SnapshotChangeEntry {
  /** ISO timestamp of the newer snapshot in the pair. */
  at: string
  changes: SnapshotChange[]
}

export interface TrackingListResponse {
  items: TrackedGigWithLatest[]
}

export interface TrackingHistoryResponse {
  gig: TrackedGig
  snapshots: TrackedGigSnapshot[]
  changes: SnapshotChangeEntry[]
}

export interface RefreshResult {
  trackedGigId: string
  ok: boolean
  error?: string
  scrapedAt?: string
}

export interface RefreshResponse {
  results: RefreshResult[]
  refreshed: number
  failed: number
}
