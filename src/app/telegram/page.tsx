import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Databases } from 'node-appwrite';
import { LinkStatus } from '@/components/link-status';
import { TelegramLink } from '@/components/telegram-link';
import { createSessionClient } from '@/lib/appwrite/clients';
import { getSessionSecret, getCurrentUser } from '@/lib/appwrite/session';
import {
  TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
  createTelegramSubscriptionsApi,
} from '@/lib/appwrite/telegram';
import { loadEnv, loadReminderEnv } from '@/lib/env';
import { deriveLinkState, telegramPageCopy } from '@/lib/telegram-view';

/**
 * Linking/status page (task 7.5, design D8): an RSC behind the shared
 * session guard. One session-scoped query reads the caller's OWN
 * subscription; any failure degrades to the unlinked view instead of
 * breaking the page (entry-point spec: "query failure → unlinked badge,
 * never throws"). When the env is disabled the query is skipped entirely and
 * the copy says so without offering a mint.
 *
 * The chat id is used only as a truth flag — never rendered (design D8).
 */
export default async function TelegramPage() {
  const user = await getCurrentUser();
  if (user === null) {
    redirect('/login?error=expired');
  }

  const secret = await getSessionSecret();
  if (secret === null) {
    redirect('/login?error=expired');
  }

  const reminderEnv = loadReminderEnv();
  const configured = reminderEnv.enabled;

  let subscription: { chatId: string; active: boolean } | null = null;
  if (configured) {
    try {
      const env = loadEnv();
      const api = createTelegramSubscriptionsApi(
        new Databases(createSessionClient(secret)),
        {
          databaseId: env.APPWRITE_DATABASE_ID,
          collectionId: TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
        },
      );
      const doc = await api.getByUser(user.id);
      subscription =
        doc === null ? null : { chatId: doc.chatId, active: doc.active };
    } catch {
      // Status is decorative here: unreadable → unlinked view, never a 500.
      subscription = null;
    }
  }

  const state = deriveLinkState(subscription, configured);
  const copy = telegramPageCopy(state);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Telegram</h1>
        <Link
          href="/"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        >
          Agenda
        </Link>
      </header>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-medium">{copy.title}</h2>
        <LinkStatus state={state} />
      </div>

      <TelegramLink state={state} />
    </main>
  );
}
