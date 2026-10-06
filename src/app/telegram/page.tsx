import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Databases } from 'node-appwrite';
import { LinkStatus } from '@/components/link-status';
import { PageShell } from '@/components/page-shell';
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
    <PageShell
      title="Telegram"
      subtitle="Recordatorios por mensaje directo"
      actions={
        <Link href="/" className="btn btn-secondary">
          Agenda
        </Link>
      }
    >
      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{copy.title}</h2>
          <LinkStatus state={state} />
        </div>

        <TelegramLink state={state} />
      </section>
    </PageShell>
  );
}
