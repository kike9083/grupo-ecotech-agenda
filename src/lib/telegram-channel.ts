import type { NotificationChannel } from './notification-channel';
import type { TelegramApi } from './telegram';

/**
 * Telegram implementation of the channel contract (design D6).
 *
 * Thin on purpose: the HTTP → outcome mapping (200 → delivered, 403 →
 * blocked, 429 → transient + `retryAfterMs`, 5xx/network → transient) already
 * lives in `createTelegramApi().sendMessage`, so the channel only binds that
 * client to the seam the scheduler sees. Provider symbols stay confined to
 * this file — never in `reminders.ts` (spec `notification-channels` →
 * "No provider coupling").
 */

/** Channel id used in logs and as the config key for future channels. */
export const TELEGRAM_CHANNEL_ID = 'telegram';

export function createTelegramChannel(api: TelegramApi): NotificationChannel {
  return {
    id: TELEGRAM_CHANNEL_ID,
    async send(target, text) {
      return api.sendMessage(target, text);
    },
  };
}
