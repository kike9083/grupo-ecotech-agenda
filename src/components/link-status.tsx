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
          ? 'badge badge-accent'
          : 'badge badge-neutral'
      }
    >
      {telegramBadgeLabel(state)}
    </span>
  );
}
