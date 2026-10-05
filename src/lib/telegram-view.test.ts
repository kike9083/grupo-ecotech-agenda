import { describe, expect, it } from 'vitest';
import {
  deriveLinkState,
  telegramBadgeLabel,
  telegramPageCopy,
  type TelegramLinkState,
} from './telegram-view';

/**
 * PR7 task 7.3 (spec `telegram-linking` → "Status shown" / "Deactivated
 * subscription on block") — the Spanish copy the page renders, kept as pure
 * helpers so wording is asserted without rendering React:
 *
 * - linked shows "Vinculado", unlinked shows "Sin vincular";
 * - blocked shows a re-link prompt (recovery is manual re-link only);
 * - not-configured says so and offers no mint;
 * - the chat id never appears in any string (design D8: chat ids are never
 *   displayed nor logged).
 */

const CHAT = '555000111';

describe('deriveLinkState (spec telegram-linking → Status shown)', () => {
  it('maps the stored subscription to the four page states', () => {
    expect(deriveLinkState(null, true)).toBe('unlinked');
    expect(
      deriveLinkState({ chatId: '', active: false }, true),
    ).toBe('unlinked');
    expect(deriveLinkState({ chatId: CHAT, active: true }, true)).toBe('linked');
    expect(deriveLinkState({ chatId: CHAT, active: false }, true)).toBe(
      'blocked',
    );
  });

  it('reports not-configured whenever the env is disabled', () => {
    expect(deriveLinkState(null, false)).toBe('not-configured');
    expect(deriveLinkState({ chatId: CHAT, active: true }, false)).toBe(
      'not-configured',
    );
  });
});

describe('telegramPageCopy (spec telegram-linking → Status shown)', () => {
  it('linked status shows "Vinculado" and never the chat id', () => {
    const copy = telegramPageCopy('linked');

    expect(copy.title).toBe('Vinculado');
    expect(copy.body).not.toContain(CHAT);
  });

  it('unlinked status shows "Sin vincular"', () => {
    expect(telegramPageCopy('unlinked').title).toBe('Sin vincular');
  });

  it('blocked shows the re-link prompt', () => {
    const copy = telegramPageCopy('blocked');

    // Delivery is off while deactivated — the badge and the title agree.
    expect(copy.title).toBe('Sin vincular');
    expect(copy.body).toMatch(/vincula de nuevo/i); // manual re-link only
    expect(copy.body).not.toContain(CHAT);
  });

  it('not-configured says so and offers no mint', () => {
    const copy = telegramPageCopy('not-configured');

    expect(copy.body).toMatch(/no están configurados/i);
    expect(copy.mint).toBe(false);
  });

  it('offers mint for every configured state', () => {
    expect(telegramPageCopy('unlinked').mint).toBe(true);
    expect(telegramPageCopy('blocked').mint).toBe(true);
    expect(telegramPageCopy('linked').mint).toBe(true); // "Actualizar"
  });
});

describe('telegramBadgeLabel (spec task-listing → Entry shows current status)', () => {
  it('has exactly two variants and maps every state to one', () => {
    const states: TelegramLinkState[] = [
      'not-configured',
      'unlinked',
      'linked',
      'blocked',
    ];
    for (const state of states) {
      const badge = telegramBadgeLabel(state);
      expect(['Vinculado', 'Sin vincular']).toContain(badge);
    }

    expect(telegramBadgeLabel('linked')).toBe('Vinculado');
    expect(telegramBadgeLabel('unlinked')).toBe('Sin vincular');
    expect(telegramBadgeLabel('blocked')).toBe('Sin vincular');
    expect(telegramBadgeLabel('not-configured')).toBe('Sin vincular');
  });
});
