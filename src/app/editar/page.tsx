import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Databases, Storage } from 'node-appwrite';
import { createAdminClient, createSessionClient } from '@/lib/appwrite/clients';
import { getSessionSecret, getCurrentUser, isAdmin } from '@/lib/appwrite/session';
import {
  ATTACHMENTS_BUCKET_ID,
  ATTACHMENTS_COLLECTION_ID,
  createAttachmentsApi,
} from '@/lib/appwrite/attachments';
import { createTasksApi } from '@/lib/appwrite/tasks';
import { loadEnv } from '@/lib/env';
import { PageShell } from '@/components/page-shell';
import { TaskForm } from '@/components/task-form';
import { AttachmentGallery } from '@/components/attachment-gallery';
import { AttachmentForm } from '@/components/attachment-form';
import { DeleteTaskButton } from '@/components/delete-task-button';
import type { RawSearchParams } from '@/lib/search-query';

/**
 * Edit route: an RSC shell that guards the session, loads the target record
 * with the caller's own credential (session for a member, API key for an
 * admin — design D2) and renders `TaskForm` in edit mode. A record the caller
 * cannot read is indistinguishable from a missing one, so both answer 404.
 * All mutation logic lives in `updateTaskAction`.
 */
export default async function EditarPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getCurrentUser();
  if (user === null) {
    redirect('/login?error=expired');
  }

  const secret = await getSessionSecret();
  if (secret === null) {
    redirect('/login?error=expired');
  }

  const params = await searchParams;
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const documentId = (rawId ?? '').trim();
  if (documentId === '') {
    notFound();
  }

  const admin = await isAdmin();
  const env = loadEnv();
  // One credential for the whole page: an admin edits anyone's record, a
  // member only their own (design D2). Storage keeps the API-key client —
  // the gallery streams through the authorized proxy, never Appwrite URLs.
  const client = admin ? createAdminClient() : createSessionClient(secret);
  const api = createTasksApi(new Databases(client), {
    databaseId: env.APPWRITE_DATABASE_ID,
    collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
    adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
  });

  const task = await api.getTask(documentId).catch(() => null);
  if (task === null) {
    notFound();
  }
  if (!admin && task.createdBy !== user.id) {
    notFound();
  }

  // Secondary data (spec `attachments` → "Attachment display"): a failure
  // never hides the edit form.
  let attachments: Awaited<
    ReturnType<ReturnType<typeof createAttachmentsApi>['listAttachmentsForRecords']>
  > = [];
  try {
    attachments = await createAttachmentsApi(
      new Databases(client),
      new Storage(createAdminClient()),
      {
        databaseId: env.APPWRITE_DATABASE_ID,
        bucketId: ATTACHMENTS_BUCKET_ID,
        collectionId: ATTACHMENTS_COLLECTION_ID,
      },
    ).listAttachmentsForRecords([task.$id]);
  } catch {
    // Leave it empty — the record is still editable.
  }

  return (
    <PageShell
      title="Editar registro"
      subtitle={`Sesión iniciada como ${user.email}`}
      actions={
        <>
          <Link href="/" className="btn btn-secondary">
            Lista
          </Link>
          <Link href="/calendario" className="btn btn-ghost">
            Calendario
          </Link>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <TaskForm
          recordId={task.$id}
          createdBy={task.createdBy}
          initial={{
            type: task.type,
            title: task.title,
            description: task.description,
            date: task.date,
            time: task.time,
          }}
        />

        <section className="card flex flex-col gap-3 p-5">
          <div>
            <h2 className="text-sm font-semibold">Archivos adjuntos</h2>
            <p className="meta mt-0.5">
              {attachments.length === 0
                ? 'Este registro todavía no tiene archivos.'
                : `${attachments.length} archivo(s) adjunto(s).`}
            </p>
          </div>
          <AttachmentGallery attachments={attachments} />
          <AttachmentForm recordId={task.$id} />
        </section>

        <section className="card flex flex-wrap items-center justify-between gap-3 border-danger/30 p-5">
          <div>
            <h2 className="text-sm font-semibold text-danger">
              Zona de peligro
            </h2>
            <p className="meta mt-0.5">
              Eliminar este registro borra también sus archivos adjuntos y no
              se puede deshacer.
            </p>
          </div>
          <DeleteTaskButton
            task={{ $id: task.$id, createdBy: task.createdBy }}
          />
        </section>
      </div>
    </PageShell>
  );
}
