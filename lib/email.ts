/**
 * Email scaffolding for activity-feed notifications.
 *
 * This module deliberately ships as a no-op so we can land the in-app
 * activity feed without forcing every deployment to pick an email
 * provider. When you're ready to send mail:
 *
 *   1. Pick a provider (Resend, Postmark, SES, etc).
 *   2. Replace the `sendNotificationEmail` body with a real call.
 *   3. Read `NOTIFY_EMAIL_FROM` and provider-specific env vars.
 *   4. Optionally honor a user preference (see `getEmailPreference` below).
 *
 * The shape of `NotificationEmailEvent` is stable, so swapping the
 * provider doesn't ripple into the detection code in `lib/notifications.ts`.
 */

import type { NotificationKind } from "@/lib/notification-types"

export interface NotificationEmailEvent {
  userId: string
  kind: NotificationKind
  title: string
  body: string
  payload: Record<string, unknown>
}

/**
 * Stubbed sender. Returns immediately; the in-app feed is the source of
 * truth until a real provider is plugged in.
 *
 * Once you swap this for a real implementation, gate sends on
 * `getEmailPreference(userId)` so the Settings toggle behaves.
 */
export async function sendNotificationEmail(
  event: NotificationEmailEvent,
): Promise<void> {
  if (process.env.NOTIFY_EMAIL_DEBUG === "1") {
    // Local-dev visibility — never enabled in production.
    console.log(
      `[email/stub] would send ${event.kind} to user ${event.userId}: ${event.title}`,
    )
  }
}

/**
 * Per-user email preference accessor. Defaults to `true` until the user
 * explicitly opts out from Settings. Persisted in `auth.users.user_metadata`
 * to avoid a dedicated `user_preferences` table.
 */
export async function getEmailPreference(
  _userId: string,
): Promise<boolean> {
  // No-op default while the toggle is UI-only. Wire this up to a real
  // lookup (e.g. `auth.users.user_metadata.email_notifications`) when you
  // ship the email provider.
  return true
}
