/**
 * Notification channel seam (design D6).
 *
 * This module — and `reminders.ts`, which orchestrates the poll — are the only
 * scheduler-side files allowed to know the contract; a source-scan test
 * (`src/lib/reminder-scan.test.ts`, task 6.9) enforces that no provider symbol
 * leaks into either of them (spec `notification-channels` → "Scheduler depends
 * only on the interface").
 *
 * Exactly three outcomes, mirroring the spec's Channel contract: the provider
 * accepted the message (`delivered`), the send failed and may be retried
 * (`transient`, when the provider supplies a server-side delay it rides
 * along), or the recipient rejected the sender (`blocked` — the scheduler then
 * deactivates the subscription).
 */

export type ChannelOutcome =
  | { status: 'delivered' }
  | { status: 'transient'; retryAfterMs?: number }
  | { status: 'blocked' };

/**
 * The contract a scheduler depends on. Implementations are additive:
 * adding a second provider later means a new file implementing this
 * interface plus a config selection — eligibility and cadence stay untouched
 * (spec `Additional channels are additive`).
 */
export interface NotificationChannel {
  /** Stable channel identifier, usable in logs and config keys. */
  readonly id: string;
  send(target: string, text: string): Promise<ChannelOutcome>;
}
