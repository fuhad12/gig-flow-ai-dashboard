/**
 * Shared types for the in-app activity feed.
 *
 * Notifications are server-generated whenever a tracker refresh detects a
 * meaningful change on a gig or its SERP rank for a tracked keyword.
 */

export type NotificationKind =
  | "tracker.price_change"
  | "tracker.title_change"
  | "tracker.thumbnail_change"
  | "tracker.tags_change"
  | "tracker.description_change"
  | "tracker.packages_change"
  | "rank.up"
  | "rank.down"
  | "rank.appeared"
  | "rank.lost"

export interface Notification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  /** Free-form structured payload (gig id, deltas, etc.). */
  payload: Record<string, unknown>
  createdAt: string
  /** ISO timestamp of when the user marked it read, or null. */
  readAt: string | null
}

export interface NotificationListResponse {
  items: Notification[]
  unreadCount: number
}
