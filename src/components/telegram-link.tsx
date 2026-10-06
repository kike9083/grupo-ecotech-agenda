'use client';

import { useActionState } from 'react';
import { mintTelegramLink, unlinkTelegram, type MintLinkState } from '@/actions/telegram';
import { telegramPageCopy, type TelegramLinkState } from '@/lib/telegram-view';

/**
 * Link/unlink controls (task 7.4, design D8) — a client wrapper around the
 * two server actions, mirroring the repo's existing forms (`useActionState`,
 * no bespoke `useState`, no polling):
 *
 * - the mint form posts once and renders the returned `{ deepLink }` as a
 *   PLAIN anchor (no QR widget, no client-side link building, no chat id);
 * - "Actualizar" (linked) re-mints — the previous deep link dies with the
 *   overwritten token (design D4);
 * - unlink only renders while a binding exists (linked or blocked).
 */
export function TelegramLink({ state }: { state: TelegramLinkState }) {
  const copy = telegramPageCopy(state);
  const [mintState, formAction, pending] = useActionState<MintLinkState, FormData>(
    mintTelegramLink,
    null,
  );
  const hasBinding = state === 'linked' || state === 'blocked';

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink">{copy.body}</p>

      {mintState?.deepLink != null ? (
        <a
          href={mintState.deepLink}
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary"
        >
          Abrir en Telegram
        </a>
      ) : null}

      {copy.mint ? (
        <form action={formAction} className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary disabled:opacity-60"
          >
            {state === 'linked' ? 'Actualizar enlace' : 'Generar enlace'}
          </button>
          {pending ? (
            <span className="meta">Generando…</span>
          ) : null}
        </form>
      ) : null}

      {hasBinding ? (
        <form action={unlinkTelegram} className="flex items-center gap-3">
          <button
            type="submit"
            className="btn btn-secondary"
          >
            Desvincular
          </button>
        </form>
      ) : null}
    </div>
  );
}
