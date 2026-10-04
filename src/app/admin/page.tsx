import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Databases } from 'node-appwrite';
import { logout } from '@/actions/auth';
import { AdminTaskList } from '@/components/admin-task-list';
import { resolveAdminAccess } from '@/lib/admin-gate';
import { loadEnv } from '@/lib/env';
import { createSessionClient } from '@/lib/appwrite/clients';
import { isDomainError } from '@/lib/appwrite/errors';
import {
  getCurrentUser,
  getSessionSecret,
  isAdmin,
} from '@/lib/appwrite/session';
import { loadAdminTasks, type TaskPage } from '@/lib/appwrite/tasks';
import { parseHomeQuery, type RawSearchParams } from '@/lib/search-query';

/**
 * Admin route (PR4 task 5.1, design D3 + D2): the minimal all-records view
 * for members of the `admins` team.
 *
 * Visibility is enforced server-side in two layers: the route gate answers
 * 404 for signed-in non-admins before any data is read (spec
 * `record-visibility` → peer isolation), and the list itself runs through
 * the session-scoped client so Appwrite enforces the `team:admins` read
 * permission natively. The API-key client is reserved for admin override
 * WRITES (status changes), never for reads (design D2).
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  const admin = user !== null ? await isAdmin() : false;

  const access = resolveAdminAccess(user, admin);
  if (access.kind === 'session') {
    redirect('/login?error=expired');
  }
  if (access.kind === 'forbidden') {
    // Spec record-visibility: a non-admin gets NONE of anyone's data here.
    notFound();
  }
  if (secret === null) {
    redirect('/login?error=expired');
  }

  const { cursor } = parseHomeQuery(await searchParams);
  const env = loadEnv();

  let page: TaskPage | null = null;
  try {
    page = await loadAdminTasks(
      secret,
      {
        config: {
          databaseId: env.APPWRITE_DATABASE_ID,
          collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
          adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
        },
        databasesFor: (sessionSecret) =>
          new Databases(createSessionClient(sessionSecret)),
      },
      { cursor },
    );
  } catch (error) {
    if (isDomainError(error) && error.kind === 'session-expired') {
      redirect('/login?error=expired');
    }
    // Other failures fall through to the inline error state (spec task-listing).
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Administración</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Volver
          </Link>
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
        Todas las tareas del equipo, con la persona responsable de cada una.
      </p>

      <AdminTaskList page={page} cursor={cursor} />
    </main>
  );
}
