import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Databases, Storage } from 'node-appwrite';
import { logout } from '@/actions/auth';
import { LinkStatus } from '@/components/link-status';
import { LoadingState } from '@/components/loading-state';
import { SearchForm } from '@/components/search-form';
import { TaskList } from '@/components/task-list';
import { loadEnv, loadReminderEnv } from '@/lib/env';
import {
  ATTACHMENTS_BUCKET_ID,
  ATTACHMENTS_COLLECTION_ID,
  createAttachmentsApi,
  groupAttachmentsByRecord,
  type Attachment,
} from '@/lib/appwrite/attachments';
import { createAdminClient, createSessionClient } from '@/lib/appwrite/clients';
import { isDomainError } from '@/lib/appwrite/errors';
import {
  getSessionSecret,
  getCurrentUser,
  isAdmin,
} from '@/lib/appwrite/session';
import {
  TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
  createTelegramSubscriptionsApi,
} from '@/lib/appwrite/telegram';
import { loadHomeTasks, type TaskPage } from '@/lib/appwrite/tasks';
import { parseHomeQuery, validateDateRange, type RawSearchParams } from '@/lib/search-query';
import {
  deriveLinkState,
  telegramEntry,
  type TelegramLinkState,
} from '@/lib/telegram-view';

/**
 * Status for the list's Telegram entry (task 7.7, spec `task-listing` →
 * "Entry shows current status"): ONE session-scoped query wrapped in
 * try/catch — a failure degrades to the unlinked badge and can never break
 * the task list. The env-disabled path skips the query entirely.
 */
async function loadTelegramEntryState(
  secret: string,
  userId: string,
): Promise<TelegramLinkState> {
  const configured = loadReminderEnv().enabled;
  if (!configured) {
    return deriveLinkState(null, false);
  }

  try {
    const env = loadEnv();
    const api = createTelegramSubscriptionsApi(
      new Databases(createSessionClient(secret)),
      {
        databaseId: env.APPWRITE_DATABASE_ID,
        collectionId: TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
      },
    );
    const doc = await api.getByUser(userId);
    return deriveLinkState(
      doc === null ? null : { chatId: doc.chatId, active: doc.active },
      configured,
    );
  } catch {
    return deriveLinkState(null, configured);
  }
}

/**
 * The data region of the home route, wrapped in its own <Suspense> (verify
 * fix F2): the loading boundary belongs HERE, co-located with the call that
 * actually streams, not in a root `loading.tsx` — a route-level boundary at
 * the root flushes status 200 for every child route before the /admin gate
 * can throw `notFound()`. Inside this boundary the behavior is unchanged:
 * data loads through the session client, session expiry redirects, other
 * failures fall through to the inline error state.
 */
async function HomeTasksSection({
  user,
  secret,
  admin,
  q,
  from,
  to,
  cursor,
}: {
  user: { id: string; email: string };
  secret: string;
  admin: boolean;
  q: string;
  from: string;
  to: string;
  cursor: string;
}) {
  const env = loadEnv();

  let page: TaskPage | null = null;
  try {
    page = await loadHomeTasks(
      user,
      secret,
      admin,
      {
        config: {
          databaseId: env.APPWRITE_DATABASE_ID,
          collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
          adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
        },
        databasesFor: (sessionSecret) =>
          new Databases(createSessionClient(sessionSecret)),
      },
      { q, cursor, from, to },
    );
  } catch (error) {
    if (isDomainError(error) && error.kind === 'session-expired') {
      // Cookie went stale mid-request: same recovery path as a null user.
      redirect('/login?error=expired');
    }
    // Other failures fall through to the inline error state (spec task-listing).
  }

  // Attachments are secondary data (spec `attachments` → "Attachment
  // display"): one batched session-scoped query, and a failure never hides
  // the record list.
  let attachmentsByRecord: Record<string, Attachment[]> = {};
  if (page !== null && page.tasks.length > 0) {
    try {
      const attachments = createAttachmentsApi(
        new Databases(createSessionClient(secret)),
        new Storage(createAdminClient()),
        {
          databaseId: env.APPWRITE_DATABASE_ID,
          bucketId: ATTACHMENTS_BUCKET_ID,
          collectionId: ATTACHMENTS_COLLECTION_ID,
        },
      );
      attachmentsByRecord = groupAttachmentsByRecord(
        await attachments.listAttachmentsForRecords(
          page.tasks.map((task) => task.$id),
        ),
      );
    } catch {
      // Leave the map empty — the records still render.
    }
  }

  return (
    <TaskList
      page={page}
      q={q}
      from={from}
      to={to}
      cursor={cursor}
      attachmentsByRecord={attachmentsByRecord}
    />
  );
}

/**
 * Home (PR3 tasks 4.1–4.3): the task list UI for the signed-in caller —
 * sorted cursor pages from the data layer, keyword search through `?q=`
 * (spec `task-search`), status/type badges, creator attribution, empty and
 * error states (spec `task-listing`), the create entry point, and the
 * success banner after a record is stored (spec `task-registration`).
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getCurrentUser();
  if (user === null) {
    // Middleware guarantees a cookie here, so null means it went stale.
    // The redirect lets middleware clear it (RSCs cannot mutate cookies).
    redirect('/login?error=expired');
  }

  const secret = await getSessionSecret();
  if (secret === null) {
    redirect('/login?error=expired');
  }

  const { q, from, to, cursor, created, noted } = parseHomeQuery(
    await searchParams,
  );
  const admin = await isAdmin();
  const telegramState = await loadTelegramEntryState(secret, user.id);
  const telegram = telegramEntry(telegramState);

  // An invalid range never runs a query (spec task-search → Invalid range):
  // the form shows the inline error and the list falls back to the plain data.
  const range = validateDateRange(from, to);
  const rangeValid = range.ok;
  const queryFrom = rangeValid ? from : '';
  const queryTo = rangeValid ? to : '';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/nueva"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            Nueva tarea
          </Link>
          <Link
            href="/nota"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            Nueva nota
          </Link>
          <Link
            href="/calendario"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Calendario
          </Link>
          <Link
            href={telegram.href}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            {telegram.label}
          </Link>
          <LinkStatus state={telegramState} />
          {admin ? (
            <Link
              href="/admin"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Administración
            </Link>
          ) : null}
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <p className="text-sm text-neutral-600">
        Sesión iniciada como <span className="font-medium">{user.email}</span>
        {admin ? ' (administrador)' : ''}
      </p>

      {created ? (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          Tarea creada correctamente.
        </p>
      ) : null}

      {noted ? (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          Nota creada correctamente.
        </p>
      ) : null}

      <SearchForm q={q} from={from} to={to} />
      {rangeValid ? (
        <Suspense fallback={<LoadingState />}>
          <HomeTasksSection
            user={user}
            secret={secret}
            admin={admin}
            q={q}
            from={queryFrom}
            to={queryTo}
            cursor={cursor}
          />
        </Suspense>
      ) : (
        <p className="text-sm text-neutral-500">
          Corrige el rango de fechas para ver resultados.
        </p>
      )}
    </main>
  );
}
