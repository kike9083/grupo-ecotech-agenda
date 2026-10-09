'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Databases, Storage } from 'node-appwrite';
import { createAdminClient, createSessionClient } from '@/lib/appwrite/clients';
import { loadEnv } from '@/lib/env';
import {
  getCurrentUser,
  getSessionSecret,
  isAdmin,
} from '@/lib/appwrite/session';
import {
  ATTACHMENTS_BUCKET_ID,
  ATTACHMENTS_COLLECTION_ID,
  createAttachmentsApi,
} from '@/lib/appwrite/attachments';
import { createTasksApi } from '@/lib/appwrite/tasks';
import {
  INITIAL_CREATE_STATE,
  SESSION_EXPIRED_REDIRECT,
  performCreateTask,
  type CreateTaskState,
} from '@/lib/task-creation';
import {
  INITIAL_DELETE_STATE,
  performDeleteTask,
  type DeleteTaskInput,
  type DeleteTaskState,
} from '@/lib/task-delete';
import {
  INITIAL_STATUS_UPDATE_STATE,
  STATUS_ERROR_MESSAGES,
  performStatusUpdate,
  type StatusUpdateInput,
  type StatusUpdateState,
} from '@/lib/task-status';
import {
  INITIAL_UPDATE_STATE,
  performUpdateTask,
  type UpdateTaskInput,
  type UpdateTaskState,
} from '@/lib/task-update';

/** Reads the raw form payload — every field optional so gaps become field errors. */
function readDraft(formData: FormData): {
  type?: string;
  title?: string;
  description?: string;
  date?: string;
  time?: string;
} {
  return {
    type: String(formData.get('type') ?? ''),
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    date: String(formData.get('date') ?? ''),
    time: String(formData.get('time') ?? ''),
  };
}

/**
 * Create-task server action (PR3 task 4.3, design D3): the thin adapter
 * between the form and the tested `performCreateTask` flow — reads the
 * payload, resolves identity, wires data access and navigation. Expected
 * failures come back as `CreateTaskState` for an inline re-render; success
 * and session recovery navigate via `redirect`.
 */
export async function createTaskAction(
  _prevState: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  const draft = readDraft(formData);

  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  if (user === null || secret === null) {
    // A stale cookie mid-request: same recovery path as the RSC pages.
    redirect(SESSION_EXPIRED_REDIRECT);
  }

  const env = loadEnv();
  let state: CreateTaskState = INITIAL_CREATE_STATE;

  await performCreateTask(
    {
      createTask: (record) =>
        createTasksApi(
          new Databases(createSessionClient(secret)),
          {
            databaseId: env.APPWRITE_DATABASE_ID,
            collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
            adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
          },
        ).createTask(record),
      onInvalid: (next) => {
        state = next;
      },
      redirect: (to) => {
        redirect(to);
      },
    },
    draft,
    user,
  );

  return state;
}

/**
 * Status-change server action (PR4 task 5.2, design D3): thin adapter over
 * the tested `performStatusUpdate` flow. Local gates (malformed input,
 * illegal transition, non-owner without the admin flag) resolve before any
 * data-layer call; on success both lists re-render, expected failures come
 * back as Spanish copy, and an expired session redirects to login.
 */
export async function updateStatusAction(
  _prevState: StatusUpdateState,
  formData: FormData,
): Promise<StatusUpdateState> {
  const input: StatusUpdateInput = {
    documentId: String(formData.get('documentId') ?? ''),
    createdBy: String(formData.get('createdBy') ?? ''),
    from: String(formData.get('from') ?? ''),
    to: String(formData.get('to') ?? ''),
  };

  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  if (user === null || secret === null) {
    redirect(SESSION_EXPIRED_REDIRECT);
  }

  const admin = await isAdmin();
  const env = loadEnv();

  const result = await performStatusUpdate(
    {
      ownerId: user.id,
      admin,
      updateStatus: (client, documentId, from, to) =>
        createTasksApi(
          client === 'admin'
            ? new Databases(createAdminClient())
            : new Databases(createSessionClient(secret)),
          {
            databaseId: env.APPWRITE_DATABASE_ID,
            collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
            adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
          },
        ).updateStatus(documentId, from, to),
    },
    input,
  );

  if (result.ok) {
    revalidatePath('/');
    revalidatePath('/admin');
    return INITIAL_STATUS_UPDATE_STATE;
  }
  if (result.reason === 'session-expired') {
    redirect(SESSION_EXPIRED_REDIRECT);
  }
  return { message: STATUS_ERROR_MESSAGES[result.reason] };
}

/**
 * Edit-record server action (design D3): thin adapter over the tested
 * `performUpdateTask` flow. Local gates (missing id, non-owner without the
 * admin flag, validation) resolve before any data-layer call; on success both
 * lists re-render and the home route shows the update banner.
 */
export async function updateTaskAction(
  _prevState: UpdateTaskState,
  formData: FormData,
): Promise<UpdateTaskState> {
  const draft = readDraft(formData);
  const input: UpdateTaskInput = {
    documentId: String(formData.get('documentId') ?? ''),
    createdBy: String(formData.get('createdBy') ?? ''),
  };

  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  if (user === null || secret === null) {
    redirect(SESSION_EXPIRED_REDIRECT);
  }

  const admin = await isAdmin();
  const env = loadEnv();
  // Admin writes only take the API-key path for someone else's record —
  // a member's own record keeps the session credential (design D2).
  const useAdminClient = admin && input.createdBy !== user.id;
  const api = createTasksApi(
    useAdminClient
      ? new Databases(createAdminClient())
      : new Databases(createSessionClient(secret)),
    {
      databaseId: env.APPWRITE_DATABASE_ID,
      collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
      adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
    },
  );

  let state: UpdateTaskState = INITIAL_UPDATE_STATE;

  await performUpdateTask(
    {
      ownerId: user.id,
      admin,
      updateTask: (documentId, record) => api.updateTask(documentId, record),
      onInvalid: (next) => {
        state = next;
      },
      redirect: (to) => {
        redirect(to);
      },
    },
    input,
    draft,
  );

  return state;
}

/**
 * Delete-record server action (design D3): thin adapter over the tested
 * `performDeleteTask` flow. The attachment cascade always runs on the
 * API-key client so it never depends on the caller reading another owner's
 * rows; the record itself takes the same owner/admin credential split as
 * `updateTaskAction`. Success revalidates every list and redirects to the
 * home route's delete banner.
 */
export async function deleteTaskAction(
  _prevState: DeleteTaskState,
  formData: FormData,
): Promise<DeleteTaskState> {
  const input: DeleteTaskInput = {
    documentId: String(formData.get('documentId') ?? ''),
    createdBy: String(formData.get('createdBy') ?? ''),
  };

  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  if (user === null || secret === null) {
    redirect(SESSION_EXPIRED_REDIRECT);
  }

  const admin = await isAdmin();
  const env = loadEnv();

  const attachments = createAttachmentsApi(
    new Databases(createAdminClient()),
    new Storage(createAdminClient()),
    {
      databaseId: env.APPWRITE_DATABASE_ID,
      bucketId: ATTACHMENTS_BUCKET_ID,
      collectionId: ATTACHMENTS_COLLECTION_ID,
    },
  );

  // Admin writes only take the API-key path for someone else's record —
  // a member's own record keeps the session credential (design D2).
  const useAdminClient = admin && input.createdBy !== user.id;
  const tasks = createTasksApi(
    useAdminClient
      ? new Databases(createAdminClient())
      : new Databases(createSessionClient(secret)),
    {
      databaseId: env.APPWRITE_DATABASE_ID,
      collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
      adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
    },
  );

  let state: DeleteTaskState = INITIAL_DELETE_STATE;

  await performDeleteTask(
    {
      ownerId: user.id,
      admin,
      listAttachments: async (recordId) =>
        (await attachments.listAttachments(recordId)).map((attachment) => ({
          documentId: attachment.$id,
          fileId: attachment.fileId,
        })),
      deleteFile: (fileId) => attachments.deleteAttachmentFile(fileId),
      deleteAttachmentDocument: (documentId) =>
        attachments.deleteAttachmentDocument(documentId),
      deleteTask: (documentId) => tasks.deleteTask(documentId),
      onInvalid: (next) => {
        state = next;
      },
      redirect: (to) => {
        revalidatePath('/');
        revalidatePath('/admin');
        revalidatePath('/calendario');
        revalidatePath('/editar');
        redirect(to);
      },
    },
    input,
  );

  return state;
}
