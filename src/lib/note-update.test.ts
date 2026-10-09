import { describe, expect, it } from 'vitest';
import type { Task } from '@/lib/appwrite/tasks';
import type { EditableNoteRecord, NoteDraft } from '@/lib/validation/note';
import { SESSION_EXPIRED_REDIRECT } from './note-creation';
import {
  INITIAL_UPDATE_NOTE_STATE,
  UPDATE_NOTE_ERROR_MESSAGES,
  UPDATE_NOTE_LOCAL_ERROR_MESSAGES,
  NOTE_UPDATE_SUCCESS_REDIRECT,
  performUpdateNote,
  type UpdateNoteDeps,
  type UpdateNoteState,
} from './note-update';

const validDraft: NoteDraft = {
  title: 'Acuerdo de octubre',
  date: '2026-10-09',
  bodyHtml: '<p>Texto de la nota</p>',
};

/** Records every dependency call so assertions cover the whole flow (design D5). */
function makeDeps(
  overrides: Partial<UpdateNoteDeps> = {},
): UpdateNoteDeps & {
  invalid: UpdateNoteState[];
  redirects: string[];
  updates: { documentId: string; record: EditableNoteRecord }[];
} {
  const invalid: UpdateNoteState[] = [];
  const redirects: string[] = [];
  const updates: { documentId: string; record: EditableNoteRecord }[] = [];

  return {
    invalid,
    redirects,
    updates,
    ownerId: 'user-123',
    admin: false,
    updateNote: async (documentId, record) => {
      updates.push({ documentId, record });
      return {
        $id: documentId,
        $createdAt: '2026-10-01T09:00:00.000+00:00',
        type: 'note',
        title: record.title,
        description: '',
        date: record.date,
        time: '',
        status: 'open',
        createdBy: 'user-123',
        createdByEmail: 'ana@grupoecotech.com',
        bodyHtml: record.bodyHtml,
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

describe('performUpdateNote', () => {
  it('exposes the home banner redirect as the exact marker', () => {
    expect(NOTE_UPDATE_SUCCESS_REDIRECT).toBe('/?updated=1');
  });

  it('blocks a missing document id before touching the data layer', async () => {
    const deps = makeDeps();

    await performUpdateNote(
      deps,
      { documentId: '', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.updates).toEqual([]);
    expect(deps.redirects).toEqual([]);
    expect(deps.invalid).toHaveLength(1);
    expect(deps.invalid[0].formError).toBe(
      UPDATE_NOTE_LOCAL_ERROR_MESSAGES.missingId,
    );
    expect(deps.invalid[0].values).toEqual(validDraft);
  });

  it('refuses a non-owner without the admin flag', async () => {
    const deps = makeDeps();

    await performUpdateNote(
      deps,
      { documentId: 'doc-1', createdBy: 'someone-else' },
      validDraft,
    );

    expect(deps.updates).toEqual([]);
    expect(deps.invalid[0].formError).toBe(
      UPDATE_NOTE_LOCAL_ERROR_MESSAGES.forbidden,
    );
  });

  it('lets an admin edit a note owned by someone else', async () => {
    const deps = makeDeps({ admin: true });

    await performUpdateNote(
      deps,
      { documentId: 'doc-1', createdBy: 'someone-else' },
      validDraft,
    );

    expect(deps.invalid).toEqual([]);
    expect(deps.updates).toHaveLength(1);
    expect(deps.redirects).toEqual([NOTE_UPDATE_SUCCESS_REDIRECT]);
  });

  it('accepts a note with no time — the task path rejects exactly this draft', async () => {
    const deps = makeDeps();

    await performUpdateNote(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      { title: 'Sin hora', bodyHtml: '<p>hola</p>' },
    );

    expect(deps.invalid).toEqual([]);
    expect('time' in deps.updates[0].record).toBe(false);
    expect(deps.updates[0].record.date).toBe('');
    expect(deps.redirects).toEqual([NOTE_UPDATE_SUCCESS_REDIRECT]);
  });

  it('re-renders with field errors for an invalid draft and never writes', async () => {
    const deps = makeDeps();

    await performUpdateNote(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      { ...validDraft, date: '2026-02-30' },
    );

    expect(deps.updates).toEqual([]);
    expect(deps.invalid[0].fieldErrors.date).toBe(
      'La fecha debe ser una fecha válida en formato AAAA-MM-DD.',
    );
    expect(deps.invalid[0].formError).toBeNull();
  });

  it('persists a PARTIAL payload with the body and the rebuilt search index', async () => {
    const deps = makeDeps();

    await performUpdateNote(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.updates).toEqual([
      {
        documentId: 'doc-1',
        record: {
          title: 'Acuerdo de octubre',
          date: '2026-10-09',
          bodyHtml: '<p>Texto de la nota</p>',
          searchText: 'Acuerdo de octubre Texto de la nota',
        },
      },
    ]);
    expect(Object.keys(deps.updates[0].record).sort()).toEqual([
      'bodyHtml',
      'date',
      'searchText',
      'title',
    ]);
    expect(deps.redirects).toEqual([NOTE_UPDATE_SUCCESS_REDIRECT]);
  });

  it('recovers an expired session via the shared login redirect', async () => {
    const deps = makeDeps({
      updateNote: async () => {
        throw { code: 401, type: 'user_session_not_found', message: 'gone' };
      },
    });

    await performUpdateNote(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.redirects).toEqual([SESSION_EXPIRED_REDIRECT]);
    expect(deps.invalid).toEqual([]);
  });

  it('surfaces a not-found note as a banner and keeps the typed values', async () => {
    const deps = makeDeps({
      updateNote: async () => {
        throw { code: 404, type: 'document_not_found', message: 'gone' };
      },
    });

    await performUpdateNote(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.invalid[0].formError).toBe(
      UPDATE_NOTE_ERROR_MESSAGES['not-found'],
    );
    expect(deps.invalid[0].values).toEqual(validDraft);
    expect(deps.redirects).toEqual([]);
  });

  it('surfaces an access message for an unauthorized failure', async () => {
    const deps = makeDeps({
      updateNote: async () => {
        throw { code: 403, type: 'user_unauthorized', message: 'nope' };
      },
    });

    await performUpdateNote(
      deps,
      { documentId: 'doc-1', createdBy: 'user-123' },
      validDraft,
    );

    expect(deps.invalid[0].formError).toBe(
      UPDATE_NOTE_ERROR_MESSAGES.unauthorized,
    );
  });

  it('starts with an empty state the form can render', () => {
    expect(INITIAL_UPDATE_NOTE_STATE).toEqual({
      fieldErrors: {},
      formError: null,
      values: {},
    });
  });
});
