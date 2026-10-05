/**
 * Telegram linking view model (task 7.4, design D8) — pure state derivation
 * and Spanish copy, no React and no data access, so wording and state rules
 * are asserted directly by `telegram-view.test.ts`.
 *
 * Spec bindings (`telegram-linking`): "Status shown" (linked shows), "Unlink"
 * (binding removed → unlinked), "Deactivated subscription on block" (re-link
 * prompt, manual recovery only), plus `task-listing` badge variants for the
 * list entry.
 *
 * Chat ids never reach any string here — the functions do not even receive
 * one (design D8: chat ids are never displayed nor logged).
 */

/** The four page/entry states (design D8). */
export type TelegramLinkState =
  | 'not-configured'
  | 'unlinked'
  | 'linked'
  | 'blocked';

/** The stored subscription slice the page reads (chat id only for truth). */
export interface LinkStateSubscription {
  chatId: string;
  active: boolean;
}

/**
 * Map storage + env to one page state:
 * - env disabled → `not-configured` (wins over everything — no mint);
 * - no row or `chatId === ''` → `unlinked` (design D7: `''` = unlinked);
 * - otherwise `active` decides `linked` vs `blocked` (a 403 deactivates but
 *   keeps the chat id so the page can show the re-link prompt).
 */
export function deriveLinkState(
  subscription: LinkStateSubscription | null,
  configured: boolean,
): TelegramLinkState {
  if (!configured) {
    return 'not-configured';
  }
  if (subscription === null || subscription.chatId === '') {
    return 'unlinked';
  }
  return subscription.active ? 'linked' : 'blocked';
}

/** Copy block the linking page renders for one state. */
export interface TelegramPageCopy {
  /** Page title / status headline. */
  title: string;
  /** Explanatory body paragraph (Spanish, neutral). */
  body: string;
  /** Whether the mint form renders (blocked re-links through mint). */
  mint: boolean;
}

/**
 * Spanish copy per state (spec scenarios quoted in the test file). Blocked
 * recovery is manual re-link only, so it offers mint but never pretends the
 * delivery link is active.
 */
export function telegramPageCopy(state: TelegramLinkState): TelegramPageCopy {
  switch (state) {
    case 'not-configured':
      return {
        title: 'Sin vincular',
        body: 'Los recordatorios por Telegram no están configurados en este entorno.',
        mint: false,
      };
    case 'unlinked':
      return {
        title: 'Sin vincular',
        body: 'Vincula tu cuenta para recibir tus recordatorios en Telegram.',
        mint: true,
      };
    case 'linked':
      return {
        title: 'Vinculado',
        body: 'Tu cuenta está vinculada. Tus recordatorios llegarán a tu chat de Telegram.',
        mint: true,
      };
    case 'blocked':
      return {
        title: 'Sin vincular',
        body: 'El bot fue bloqueado. Vincula de nuevo para volver a recibir tus recordatorios.',
        mint: true,
      };
  }
}

/** Badge variants (spec `task-listing` → "Entry shows current status"). */
export type TelegramBadge = 'Vinculado' | 'Sin vincular';

/**
 * Short badge label: exactly two variants for any state — `linked` delivers,
 * everything else (unlinked, blocked, not-configured, query failure mapped
 * through `deriveLinkState(null, …)`) reads as not linked.
 */
export function telegramBadgeLabel(state: TelegramLinkState): TelegramBadge {
  return state === 'linked' ? 'Vinculado' : 'Sin vincular';
}

/** The list entry's immutable address (spec `task-listing` → entry point). */
export const TELEGRAM_ENTRY = { href: '/telegram', label: 'Telegram' } as const;

/** What the list header renders for the entry: address + status badge. */
export interface TelegramEntry {
  href: string;
  label: string;
  badge: TelegramBadge;
}

/**
 * Entry descriptor for EVERY state (spec `task-listing` → "Entry present
 * when unlinked" / "Entry shows current status"): the label and href are
 * constant — only the badge follows the state, and a failed status query
 * maps through `deriveLinkState(null, …)` to the unlinked badge without
 * ever throwing.
 */
export function telegramEntry(state: TelegramLinkState): TelegramEntry {
  return {
    href: TELEGRAM_ENTRY.href,
    label: TELEGRAM_ENTRY.label,
    badge: telegramBadgeLabel(state),
  };
}
