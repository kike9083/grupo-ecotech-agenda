import { describe, expect, it } from 'vitest';
import {
  createTasksApi,
  type DatabasesLike,
  type RawDocument,
  type TasksConfig,
} from '@/lib/appwrite/tasks';
import type { Task } from '@/lib/appwrite/tasks';
import type { NoteRecord } from '@/lib/validation/note';
import {
  INITIAL_NOTE_STATE,
  NOTE_SUCCESS_REDIRECT,
  SESSION_EXPIRED_REDIRECT,
  performCreateNote,
  type CreateNoteDeps,
  type CreateNoteState,
} from './note-creation';

const owner = { id: 'user-123', email: 'ana@grupoecotech.com' };

const config: TasksConfig = {
  databaseId: 'agenda',
  collectionId: 'tasks',
  adminsTeamId: 'admins',
};

interface CreateCall {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown>;
  permissions: string[] | undefined;
}

/** Records the wire payload so the note flow is asserted end-to-end (design D5). */
class FakeDatabases implements DatabasesLike {
  createCalls: CreateCall[] = [];
  nextError: unknown = undefined;

  async createDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: Record<string, unknown>,
    permissions?: string[],
  ): Promise<RawDocument> {
    this.createCalls.push({
      databaseId,
      collectionId,
      documentId,
      data,
      permissions,
    });
    if (this.nextError !== undefined) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }
    return {
      $id: documentId,
      $createdAt: '2026-10-04T19:38:25.692+00:00',
      ...data,
    };
  }

  async listDocuments(): Promise<{ total: number; documents: RawDocument[] }> {
    return { total: 0, documents: [] };
  }

  async updateDocument(): Promise<RawDocument> {
    return { $id: 'doc-1' };
  }
}

function makeDeps(fake: FakeDatabases): CreateNoteDeps & {
  invalid: CreateNoteState[];
  redirects: string[];
} {
  const invalid: CreateNoteState[] = [];
  const redirects: string[] = [];

  return {
    invalid,
    redirects,
    createNote: (record: NoteRecord): Promise<Task> =>
      createTasksApi(fake, config).createTask(record),
    onInvalid: (state) => {
      invalid.push(state);
    },
    redirect: (to) => {
      redirects.push(to);
    },
  };
}

describe('performCreateNote (spec note-capture → Note creation)', () => {
  it('persists a note with creator permissions, derived searchText and sentinels', async () => {
    const fake = new FakeDatabases();
    const deps = makeDeps(fake);

    await performCreateNote(
      deps,
      {
        title: 'Reunión',
        bodyHtml: '<p>Acuerdo de <strong>octubre</strong></p>',
        date: '2026-10-04',
      },
      owner,
    );

    expect(fake.createCalls).toHaveLength(1);
    const call = fake.createCalls[0];
    expect(call.databaseId).toBe('agenda');
    expect(call.collectionId).toBe('tasks');
    expect(call.data).toEqual({
      type: 'note',
      title: 'Reunión',
      description: '',
      date: '2026-10-04',
      time: '',
      status: 'open',
      createdBy: 'user-123',
      createdByEmail: 'ana@grupoecotech.com',
      bodyHtml: '<p>Acuerdo de <strong>octubre</strong></p>',
      searchText: 'Reunión Acuerdo de octubre',
    });
    // F3b: creator-only grants — a member session cannot grant `team:admins`;
    // admins read through the collection-level grant.
    expect(call.permissions).toEqual([
      'read("user:user-123")',
      'write("user:user-123")',
    ]);
    expect(deps.invalid).toEqual([]);
    expect(deps.redirects).toEqual([NOTE_SUCCESS_REDIRECT]);
  });

  it('stores an undated note with the empty date sentinel and body-only search text', async () => {
    const fake = new FakeDatabases();
    const deps = makeDeps(fake);

    await performCreateNote(
      deps,
      { bodyHtml: '<p>Recordatorio suelto</p>' },
      owner,
    );

    const call = fake.createCalls[0];
    expect(call.data.date).toBe('');
    expect(call.data.title).toBe('');
    expect(call.data.searchText).toBe(' Recordatorio suelto');
    expect(deps.redirects).toEqual([NOTE_SUCCESS_REDIRECT]);
  });

  it('blocks an invalid draft with Spanish field errors and never writes', async () => {
    const fake = new FakeDatabases();
    const deps = makeDeps(fake);

    await performCreateNote(
      deps,
      { title: 'a'.repeat(201), date: '2026-13-40', bodyHtml: '<p>x</p>' },
      owner,
    );

    expect(fake.createCalls).toEqual([]);
    expect(deps.redirects).toEqual([]);
    expect(deps.invalid).toHaveLength(1);
    expect(deps.invalid[0].fieldErrors.title).toBe(
      'El título debe tener como máximo 200 caracteres.',
    );
    expect(deps.invalid[0].fieldErrors.date).toBe(
      'La fecha debe ser una fecha válida en formato AAAA-MM-DD.',
    );
    expect(deps.invalid[0].formError).toBeNull();
  });

  it('re-renders with a Spanish banner when the data layer rejects the note', async () => {
    const fake = new FakeDatabases();
    fake.nextError = {
      code: 400,
      type: 'document_invalid_data',
      message: 'bad data',
    };
    const deps = makeDeps(fake);

    await performCreateNote(deps, { title: 'Nota' }, owner);

    expect(deps.redirects).toEqual([]);
    expect(deps.invalid[0].fieldErrors).toEqual({});
    expect(deps.invalid[0].formError).toBe(
      'Los datos no son válidos. Revisa el formulario.',
    );
  });

  it('redirects to the login recovery route when the session expired', async () => {
    const fake = new FakeDatabases();
    fake.nextError = {
      code: 401,
      type: 'user_session_expired',
      message: 'expired',
    };
    const deps = makeDeps(fake);

    await performCreateNote(deps, { title: 'Nota' }, owner);

    expect(deps.redirects).toEqual([SESSION_EXPIRED_REDIRECT]);
    expect(deps.invalid).toEqual([]);
  });

  it('surfaces an access message for an unauthorized failure', async () => {
    const fake = new FakeDatabases();
    fake.nextError = {
      code: 403,
      type: 'user_unauthorized',
      message: 'forbidden',
    };
    const deps = makeDeps(fake);

    await performCreateNote(deps, { title: 'Nota' }, owner);

    expect(deps.invalid[0].formError).toBe(
      'No tienes permiso para crear notas.',
    );
  });

  it('falls back to a generic save message for transport failures', async () => {
    const fake = new FakeDatabases();
    fake.nextError = new Error('fetch failed');
    const deps = makeDeps(fake);

    await performCreateNote(deps, { title: 'Nota' }, owner);

    expect(deps.invalid[0].formError).toBe(
      'No se pudo guardar la nota. Intenta de nuevo.',
    );
  });

  it('exports an empty initial state for the note form to start from', () => {
    expect(INITIAL_NOTE_STATE).toEqual({
      fieldErrors: {},
      formError: null,
      values: {},
    });
  });
});
