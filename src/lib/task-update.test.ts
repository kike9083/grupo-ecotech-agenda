import { describe, expect, it } from 'vitest';
import type { Task } from '@/lib/appwrite/tasks';
import type { EditableTaskRecord, TaskDraft } from '@/lib/validation/task';
import { SESSION_EXPIRED_REDIRECT } from './task-creation';
import {
  INITIAL_UPDATE_STATE,
  UPDATE_ERROR_MESSAGES,
  UPDATE_LOCAL_ERROR_MESSAGES,
  UPDATE_SUCCESS_REDIRECT,
  performUpdateTask,
  type UpdateTaskDeps,
  type UpdateTaskState,
} from './task-update';

const validDraft: TaskDraft = {
  type: 'event',
  title: 'Reunión con el cliente',
  description: 'Visita a la planta',
  date: '2026-10-08',
  time: '11:00',
};

/** Records every dependency call so assertions cover the whole flow (design D5). */
function makeDeps(
  overrides: Partial<UpdateTaskDeps> = {},
): UpdateTaskDeps & {
  invalid: UpdateTaskState[];
  redirects: string[];
  updates: { documentId: string; record: EditableTaskRecord }[];
} {
  const invalid: UpdateTaskState[] = [];
  const redirects: string[] = [];
  const updates: { documentId: string; record: EditableTaskRecord }[] = [];

  return {
    invalid,
    redirects,
    updates,
    ownerId: 'user-123',
    admin: false,
    updateTask: async (documentId, record) => {
      updates.push({ documentId, record });
      return {
        $id: documentId,
        $createdAt: '2026-10-01T09:00:00.000+00:00',
        ...record,
        status: 'open',
        createdBy: 'user-123',
        createdByEmail: 'ana@grupoecotech.com',
      } satisfies Task;
    },
    onInvalid: (state) => {
      invalid.push(state);
    },
    redirect: (to) => {
      redirects.push(to);
    },
    ...overrides,
  };
}

describe('performUpdateTask', () => {
  it('exposes the home banner redirect as the exact marker', () => {
    expect(UPDATE_SUCCESS_REDIRECT).toBe('/?updated=1');
  });

  it('blocks a missing document id before touching the data layer', async () => {
    const deps = makeDeps();

    await performUpdateTask(
      deps,
      { documentId: '', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.updates).toEqual([]);
    expect(deps.redirects).toEqual([]);
    expect(deps.invalid).toHaveLength(1);
    expect(deps.invalid[0].formError).toBe(
      UPDATE_LOCAL_ERROR_MESSAGES.missingId,
    );
    expect(deps.invalid[0].values).toEqual(validDraft);
  });

  it('refuses a non-owner without the admin flag', async () => {
    const deps = makeDeps();

    await performUpdateTask(
      deps,
      { documentId: 'doc-1', createdBy: 'someone-else' },
      validDraft,
    );

    expect(deps.updates).toEqual([]);
    expect(deps.invalid[0].formError).toBe(
      UPDATE_LOCAL_ERROR_MESSAGES.forbidden,
    );
  });

  it('lets an admin edit a record owned by someone else', async () => {
    const deps = makeDeps({ admin: true });

    await performUpdateTask(
      deps,
      { documentId: 'doc-1', createdBy: 'someone-else' },
      validDraft,
    );

    expect(deps.invalid).toEqual([]);
    expect(deps.updates).toHaveLength(1);
    expect(deps.redirects).toEqual([UPDATE_SUCCESS_REDIRECT]);
  });

  it('re-renders with field errors for an invalid draft and never writes', async () => {
    const deps = makeDeps();

    await performUpdateTask(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      { ...validDraft, title: '   ' },
    );

    expect(deps.updates).toEqual([]);
    expect(deps.invalid[0].fieldErrors.title).toBe('El título es obligatorio.');
    expect(deps.invalid[0].formError).toBeNull();
  });

  it('sends a PARTIAL payload so status, ownership and note body survive', async () => {
    const deps = makeDeps();

    await performUpdateTask(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.updates).toEqual([
      {
        documentId: 'doc-1',
        record: {
          type: 'event',
          title: 'Reunión con el cliente',
          description: 'Visita a la planta',
          date: '2026-10-08',
          time: '11:00',
          searchText: 'Reunión con el cliente Visita a la planta',
        },
      },
    ]);
    expect(Object.keys(deps.updates[0].record).sort()).toEqual([
      'date',
      'description',
      'searchText',
      'time',
      'title',
      'type',
    ]);
    expect(deps.redirects).toEqual([UPDATE_SUCCESS_REDIRECT]);
  });

  it('recovers an expired session via the shared login redirect', async () => {
    const deps = makeDeps({
      updateTask: async () => {
        throw { code: 401, type: 'user_session_not_found', message: 'gone' };
      },
    });

    await performUpdateTask(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.redirects).toEqual([SESSION_EXPIRED_REDIRECT]);
    expect(deps.invalid).toEqual([]);
  });

  it('surfaces a not-found record as a banner and keeps the typed values', async () => {
    const deps = makeDeps({
      updateTask: async () => {
        throw { code: 404, type: 'document_not_found', message: 'gone' };
      },
    });

    await performUpdateTask(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.invalid[0].formError).toBe(
      UPDATE_ERROR_MESSAGES['not-found'],
    );
    expect(deps.invalid[0].values).toEqual(validDraft);
    expect(deps.redirects).toEqual([]);
  });

  it('starts with an empty state the form can render', () => {
    expect(INITIAL_UPDATE_STATE).toEqual({
      fieldErrors: {},
      formError: null,
      values: {},
    });
  });
});
