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
    <div className="min-h-screen">
      <header className="frosted">
        <div className="page-shell flex min-h-16 flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-xl bg-accent-soft"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5 text-accent"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
              </svg>
            </span>
            <div className="flex flex-col leading-tight">
              <h1 className="text-base font-bold">Agenda</h1>
              <span className="meta">Grupo Ecotech</span>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-end gap-2">
            <Link href="/nueva" className="btn btn-primary">
              Nueva tarea
            </Link>
            <Link href="/nota" className="btn btn-secondary">
              Nueva nota
            </Link>
            <Link href="/calendario" className="btn btn-secondary">
              Calendario
            </Link>
            <Link href={telegram.href} className="btn btn-secondary">
              {telegram.label}
            </Link>
            <LinkStatus state={telegramState} />
            {admin ? (
              <Link href="/admin" className="btn btn-secondary">
                Administración
              </Link>
            ) : null}
            <form action={logout}>
              <button type="submit" className="btn btn-ghost">
                Cerrar sesión
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="page-shell flex flex-col gap-6 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold">Tareas y solicitudes</h2>
            <p className="meta mt-1">
              Sesión iniciada como{' '}
              <span className="font-semibold text-ink">{user.email}</span>
              {admin ? ' (administrador)' : ''}
            </p>
          </div>
        </div>

        {created ? (
          <p role="status" className="banner banner-success">
            Tarea creada correctamente.
          </p>
        ) : null}

        {noted ? (
          <p role="status" className="banner banner-success">
            Nota creada correctamente.
          </p>
        ) : null}

        <div className="mx-auto w-full max-w-3xl">
          <SearchForm q={q} from={from} to={to} />
          {rangeValid ? (
            <div className="mt-4">
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
            </div>
          ) : (
            <p className="banner banner-danger mt-4">
              Corrige el rango de fechas para ver resultados.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
