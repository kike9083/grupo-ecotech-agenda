import { redirect } from 'next/navigation';
import { Databases } from 'node-appwrite';
import { logout } from '@/actions/auth';
import { loadEnv } from '@/lib/env';
import { createSessionClient } from '@/lib/appwrite/clients';
import { isDomainError } from '@/lib/appwrite/errors';
import {
  getSessionSecret,
  getCurrentUser,
  isAdmin,
} from '@/lib/appwrite/session';
import { loadHomeTasks, type TaskPage } from '@/lib/appwrite/tasks';

/**
 * Home (PR2 task 3.4): server-side list through the data layer — proves the
 * validation/data-access stack wires up with a real session. Visual polish
 * (search box, pagination UI, states) lands in PR3.
 */
export default async function HomePage() {
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

  const env = loadEnv();
  const admin = await isAdmin();

  let page: TaskPage | null = null;
  try {
    page = await loadHomeTasks(user, secret, admin, {
      config: {
        databaseId: env.APPWRITE_DATABASE_ID,
        collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
        adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
      },
      databasesFor: (sessionSecret) =>
        new Databases(createSessionClient(sessionSecret)),
    });
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
            Sign out
          </button>
        </form>
      </header>

      <p className="text-sm text-neutral-600">
        Signed in as <span className="font-medium">{user.email}</span>
        {admin ? ' (admin)' : ''}
      </p>

      {page === null ? (
        <p role="alert" className="text-sm text-red-700">
          Could not load tasks. Please try again later.
        </p>
      ) : page.tasks.length === 0 ? (
        <p className="text-sm text-neutral-500">No tasks yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {page.tasks.map((task) => (
            <li
              key={task.$id}
              className="flex items-center justify-between rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <span className="font-medium">{task.title}</span>
              <span className="text-neutral-500">
                {task.date} {task.time} · {task.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
