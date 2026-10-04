import { redirect } from 'next/navigation';
import { Databases } from 'node-appwrite';
import { logout } from '@/actions/auth';
import { SearchForm } from '@/components/search-form';
import { TaskList } from '@/components/task-list';
import { loadEnv } from '@/lib/env';
import { createSessionClient } from '@/lib/appwrite/clients';
import { isDomainError } from '@/lib/appwrite/errors';
import {
  getSessionSecret,
  getCurrentUser,
  isAdmin,
} from '@/lib/appwrite/session';
import { loadHomeTasks, type TaskPage } from '@/lib/appwrite/tasks';
import { parseHomeQuery, type RawSearchParams } from '@/lib/search-query';

/**
 * Home (PR3 tasks 4.1–4.2): the task list UI for the signed-in caller —
 * sorted cursor pages from the data layer, keyword search through `?q=`
 * (spec `task-search`), status/type badges, creator attribution, empty and
 * error states (spec `task-listing`). The create entry point lands with 4.3.
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

  const { q, cursor } = parseHomeQuery(await searchParams);
  const env = loadEnv();
  const admin = await isAdmin();

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
      { q, cursor },
    );
  } catch (error) {
    if (isDomainError(error) && error.kind === 'session-expired') {
      // Cookie went stale mid-request: same recovery path as a null user.
      redirect('/login?error=expired');
    }
    // Other failures fall through to the inline error state (spec task-listing).
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Cerrar sesión
          </button>
        </form>
      </header>

      <p className="text-sm text-neutral-600">
        Sesión iniciada como <span className="font-medium">{user.email}</span>
        {admin ? ' (administrador)' : ''}
      </p>

      <SearchForm q={q} />
      <TaskList page={page} q={q} cursor={cursor} />
    </main>
  );
}
