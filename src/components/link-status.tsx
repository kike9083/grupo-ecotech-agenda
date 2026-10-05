import { telegramBadgeLabel, type TelegramLinkState } from '@/lib/telegram-view';

/**
 * Status chip (task 7.4, design D8): two variants only — emerald when the
 * link delivers, neutral otherwise. Feeds the list entry and the linking
 * page; the chat id never appears in it.
 */
export function LinkStatus({ state }: { state: TelegramLinkState }) {
  const linked = state === 'linked';

  return (
    <span
      className={
        linked
          ? 'rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
          : 'rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600'
      }
    >
      {telegramBadgeLabel(state)}
    </span>
  );
}
