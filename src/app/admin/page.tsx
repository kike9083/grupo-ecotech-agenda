import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Databases } from 'node-appwrite';
import { logout } from '@/actions/auth';
import { AdminTaskList } from '@/components/admin-task-list';
import { PageShell } from '@/components/page-shell';
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
import { parseAdminQuery, type RawSearchParams } from '@/lib/search-query';
import { TASK_STATUSES, TASK_TYPES } from '@/lib/validation/task';
import { statusLabel, typeLabel } from '@/lib/task-view';

/**
 * Admin route (PR4 tasks 5.1–5.2, design D3 + D2): the minimal all-records
 * view for members of the `admins` team, with status/type/creator filters.
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

  const query = parseAdminQuery(await searchParams);
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
      {
        cursor: query.cursor,
        status: query.status,
        type: query.type,
        creator: query.creator,
      },
    );
  } catch (error) {
    if (isDomainError(error) && error.kind === 'session-expired') {
      redirect('/login?error=expired');
    }
    // Other failures fall through to the inline error state (spec task-listing).
  }

  return (
    <PageShell
      title="Administración"
      subtitle={user === null ? 'Grupo Ecotech' : user.email}
      actions={
        <>
          <Link href="/" className="btn btn-secondary">
            Volver
          </Link>
          <form action={logout}>
            <button type="submit" className="btn btn-ghost">
              Cerrar sesión
            </button>
          </form>
        </>
      }
    >
      <p className="meta">
        Todas las tareas del equipo, con la persona responsable de cada una.
      </p>

      <form
        method="get"
        action="/admin"
        className="card flex flex-wrap items-end gap-3 p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="field-label">
            Estado
          </label>
          <select
            id="status"
            name="status"
            defaultValue={query.status ?? ''}
            className="field"
          >
            <option value="">Todos</option>
            {TASK_STATUSES.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="type" className="field-label">
            Tipo
          </label>
          <select
            id="type"
            name="type"
            defaultValue={query.type ?? ''}
            className="field"
          >
            <option value="">Todos</option>
            {TASK_TYPES.map((option) => (
              <option key={option} value={option}>
                {typeLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="creator" className="field-label">
            Creador
          </label>
          <input
            id="creator"
            name="creator"
            type="text"
            defaultValue={query.creator}
            placeholder="correo@ejemplo.com"
            className="field min-w-0"
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
        >
          Aplicar
        </button>
        {query.filtered ? (
          <a href="/admin" className="btn btn-ghost">
            Limpiar
          </a>
        ) : null}
      </form>

      <AdminTaskList page={page} query={query} />
    </PageShell>
  );
}
