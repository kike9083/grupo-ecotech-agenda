'use server';

import { redirect } from 'next/navigation';
import { Databases } from 'node-appwrite';
import { createSessionClient } from '@/lib/appwrite/clients';
import { loadEnv } from '@/lib/env';
import { getCurrentUser, getSessionSecret } from '@/lib/appwrite/session';
import { createTasksApi } from '@/lib/appwrite/tasks';
import {
  INITIAL_NOTE_STATE,
  SESSION_EXPIRED_REDIRECT,
  performCreateNote,
  type CreateNoteState,
} from '@/lib/note-creation';

/** Reads the raw note form payload — every field optional so gaps become sentinels. */
function readNoteDraft(formData: FormData): {
  title?: string;
  bodyHtml?: string;
  date?: string;
} {
  return {
    title: String(formData.get('title') ?? ''),
    bodyHtml: String(formData.get('bodyHtml') ?? ''),
    date: String(formData.get('date') ?? ''),
  };
}

/**
 * Create-note server action (PR2 task 2.6, design D1): the thin adapter
 * between the note form and the tested `performCreateNote` flow — reads the
 * payload, resolves identity, wires the session-scoped data access and
 * navigation. Expected failures come back as `CreateNoteState` for an inline
 * re-render; success and session recovery navigate via `redirect`.
 */
export async function createNoteAction(
  _prevState: CreateNoteState,
  formData: FormData,
): Promise<CreateNoteState> {
  const draft = readNoteDraft(formData);

  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  if (user === null || secret === null) {
    redirect(SESSION_EXPIRED_REDIRECT);
  }

  const env = loadEnv();
  let state: CreateNoteState = INITIAL_NOTE_STATE;

  await performCreateNote(
    {
      createNote: (record) =>
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
