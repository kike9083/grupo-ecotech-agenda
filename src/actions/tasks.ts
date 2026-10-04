'use server';

import { redirect } from 'next/navigation';
import { Databases } from 'node-appwrite';
import { createSessionClient } from '@/lib/appwrite/clients';
import { loadEnv } from '@/lib/env';
import { getCurrentUser, getSessionSecret } from '@/lib/appwrite/session';
import { createTasksApi } from '@/lib/appwrite/tasks';
import {
  INITIAL_CREATE_STATE,
  SESSION_EXPIRED_REDIRECT,
  performCreateTask,
  type CreateTaskState,
} from '@/lib/task-creation';

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
