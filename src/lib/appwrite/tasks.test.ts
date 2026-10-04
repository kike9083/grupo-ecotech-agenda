import { describe, expect, it } from 'vitest';
import { isDomainError } from './errors';
import {
  CALENDAR_PAGE_SIZE,
  createTasksApi,
  loadAdminTasks,
  loadCalendarTasks,
  loadHomeTasks,
  type DatabasesLike,
  type RawDocument,
  type TaskScope,
  type TasksConfig,
} from './tasks';
import type { TaskRecord } from '@/lib/validation/task';

const config: TasksConfig = {
  databaseId: 'agenda',
  collectionId: 'tasks',
  adminsTeamId: 'admins',
};

const record: TaskRecord = {
  type: 'task',
  title: 'Prepare invoice',
  description: 'Send the October invoice',
  date: '2026-10-05',
  time: '09:30',
  status: 'open',
  createdBy: 'user-123',
  createdByEmail: 'owner@example.com',
  searchText: 'Prepare invoice Send the October invoice',
};

interface CreateCall {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown>;
  permissions: string[] | undefined;
}

interface ListCall {
  databaseId: string;
  collectionId: string;
  queries: string[];
}

interface UpdateCall {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown> | undefined;
}

/** Records every invocation — asserts go against the wire payload, not mocks (design D5). */
class FakeDatabases implements DatabasesLike {
  createCalls: CreateCall[] = [];
  listCalls: ListCall[] = [];
  updateCalls: UpdateCall[] = [];
  /** When set, the next call rejects with it (one-shot), like a real failure. */
  nextError: unknown = undefined;
  nextList: { total: number; documents: RawDocument[] } = {
    total: 0,
    documents: [],
  };

  private takeError(): void {
    if (this.nextError !== undefined) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }
  }

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
    this.takeError();
    return {
      $id: documentId,
      $createdAt: '2026-10-01T09:00:00.000+00:00',
      ...data,
    };
  }

  async listDocuments(
    databaseId: string,
    collectionId: string,
    queries: string[] = [],
  ): Promise<{ total: number; documents: RawDocument[] }> {
    this.listCalls.push({ databaseId, collectionId, queries });
    this.takeError();
    return this.nextList;
  }

  async updateDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data?: Record<string, unknown>,
  ): Promise<RawDocument> {
    this.updateCalls.push({ databaseId, collectionId, documentId, data });
    this.takeError();
    // The real service returns the full document after a partial update.
    return { ...storedDocument(documentId), ...data };
  }
}

function storedDocument(
  id: string,
  overrides: Record<string, unknown> = {},
): RawDocument {
  return {
    $id: id,
    $createdAt: '2026-10-01T09:00:00.000+00:00',
    type: 'task',
    title: `Task ${id}`,
    description: 'Stored description',
    date: '2026-10-01',
    time: '09:00',
    status: 'open',
    createdBy: 'user-123',
    createdByEmail: 'owner@example.com',
    searchText: 'Task stored description',
    ...overrides,
  };
}

/** Parses the JSON-string queries (gotcha 4) back into objects for assertions. */
function parsedQueries(call: ListCall | undefined): Array<
  Record<string, unknown>
> {
  return (call?.queries ?? []).map((query) => JSON.parse(query));
}

function hasQuery(
  queries: Array<Record<string, unknown>>,
  method: string,
  attribute?: string,
): boolean {
  return queries.some(
    (query) =>
      query.method === method &&
      (attribute === undefined || query.attribute === attribute),
  );
}

const ownerScope: TaskScope = { admin: false, ownerId: 'user-123' };
const adminScope: TaskScope = { admin: true };

describe('createTask', () => {
  it('persists all nine attributes in the data wrapper with owner permissions', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    await api.createTask(record);

    expect(fake.createCalls).toHaveLength(1);
    const call = fake.createCalls[0];
    expect(call.databaseId).toBe('agenda');
    expect(call.collectionId).toBe('tasks');
    expect(call.documentId).not.toBe('');
    expect(call.data).toEqual({
      type: 'task',
      title: 'Prepare invoice',
      description: 'Send the October invoice',
      date: '2026-10-05',
      time: '09:30',
      status: 'open',
      createdBy: 'user-123',
      createdByEmail: 'owner@example.com',
      searchText: 'Prepare invoice Send the October invoice',
    });
    // F3b: no `team:` grant — Appwrite rejects roles the creator does not
    // hold (401 for members); admins read via the collection-level grant.
    expect(call.permissions).toEqual([
      'read("user:user-123")',
      'write("user:user-123")',
    ]);
  });

  it('scopes the document grants to a different creator without any team role', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    await api.createTask({ ...record, createdBy: 'user-999' });

    expect(fake.createCalls[0].permissions).toEqual([
      'read("user:user-999")',
      'write("user:user-999")',
    ]);
  });

  it('returns the created document as a Task without the searchText attribute', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    const task = await api.createTask(record, 'fixed-doc-id');

    expect(fake.createCalls[0].documentId).toBe('fixed-doc-id');
    expect(task).toEqual({
      $id: 'fixed-doc-id',
      $createdAt: '2026-10-01T09:00:00.000+00:00',
      type: 'task',
      title: 'Prepare invoice',
      description: 'Send the October invoice',
      date: '2026-10-05',
      time: '09:30',
      status: 'open',
      createdBy: 'user-123',
      createdByEmail: 'owner@example.com',
    });
  });

  it('maps the optional bodyHtml of a note into the payload and read model (spec note-capture)', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    const note = await api.createTask({
      type: 'note',
      title: 'Reunión',
      description: '',
      date: '',
      time: '',
      status: 'open',
      createdBy: 'user-123',
      createdByEmail: 'owner@example.com',
      bodyHtml: '<p>Acta</p>',
      searchText: 'Reunión Acta',
    });

    expect(fake.createCalls[0].data.bodyHtml).toBe('<p>Acta</p>');
    expect(note.type).toBe('note');
    expect(note.bodyHtml).toBe('<p>Acta</p>');
    expect(note.$createdAt).toBe('2026-10-01T09:00:00.000+00:00');
  });

  it('generates a distinct document id per create when none is given', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    await api.createTask(record);
    await api.createTask(record);

    const [first, second] = fake.createCalls.map((call) => call.documentId);
    expect(first).not.toBe('');
    expect(second).not.toBe('');
    expect(first).not.toBe(second);
  });
});

describe('listTasks', () => {
  it('scopes the non-admin path to the caller with date/time/$id desc and page size 20', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 42,
      documents: [storedDocument('a'), storedDocument('b')],
    };
    const api = createTasksApi(fake, config);

    const page = await api.listTasks(ownerScope);

    const call = fake.listCalls[0];
    expect(call.databaseId).toBe('agenda');
    expect(call.collectionId).toBe('tasks');
    const queries = parsedQueries(call);
    expect(queries).toEqual(
      expect.arrayContaining([
        { method: 'limit', values: [20] },
        { method: 'orderDesc', attribute: 'date' },
        { method: 'orderDesc', attribute: 'time' },
        { method: 'orderDesc', attribute: '$id' },
        { method: 'equal', attribute: 'createdBy', values: ['user-123'] },
      ]),
    );
    expect(hasQuery(queries, 'cursorAfter')).toBe(false);
    expect(page.tasks.map((task) => task.$id)).toEqual(['a', 'b']);
    expect(page.tasks[0]).toMatchObject({
      title: 'Task a',
      createdByEmail: 'owner@example.com',
    });
    // Partial page → no further cursor.
    expect(page.nextCursor).toBeNull();
  });

  it('returns the last document id as the cursor when the page is full', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 40,
      documents: Array.from({ length: 20 }, (_, index) =>
        storedDocument(`d${index}`),
      ),
    };
    const api = createTasksApi(fake, config);

    const page = await api.listTasks(ownerScope);

    expect(page.tasks).toHaveLength(20);
    expect(page.nextCursor).toBe('d19');
  });

  it('lists without a createdBy filter for admins (spec record-visibility)', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 3,
      documents: [storedDocument('x', { createdBy: 'someone-else' })],
    };
    const api = createTasksApi(fake, config);

    const page = await api.listTasks(adminScope);

    const queries = parsedQueries(fake.listCalls[0]);
    expect(hasQuery(queries, 'equal', 'createdBy')).toBe(false);
    expect(hasQuery(queries, 'limit')).toBe(true);
    expect(page.tasks[0].createdBy).toBe('someone-else');
  });

  it('orders undated records by $createdAt descending (spec task-listing → Undated note listed)', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 2,
      documents: [
        storedDocument('nueva', {
          type: 'note',
          title: '',
          date: '',
          time: '',
          bodyHtml: '<p>Nota reciente</p>',
        }),
        storedDocument('vieja', {
          type: 'note',
          title: '',
          date: '',
          time: '',
          bodyHtml: '<p>Nota vieja</p>',
        }),
      ],
    };
    const api = createTasksApi(fake, config);

    const page = await api.listTasks(ownerScope);

    const queries = parsedQueries(fake.listCalls[0]);
    expect(queries).toEqual(
      expect.arrayContaining([{ method: 'orderDesc', attribute: '$createdAt' }]),
    );
    // The undated notes still come back and keep their creation order.
    expect(page.tasks.map((task) => task.$id)).toEqual(['nueva', 'vieja']);
    expect(page.tasks[0].$createdAt).toBe('2026-10-01T09:00:00.000+00:00');
  });

  it('continues from the cursor when one is provided', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 40, documents: [storedDocument('z')] };
    const api = createTasksApi(fake, config);

    await api.listTasks({ ...ownerScope, cursorAfter: 'd19' });

    const queries = parsedQueries(fake.listCalls[0]);
    expect(queries).toEqual(
      expect.arrayContaining([{ method: 'cursorAfter', values: ['d19'] }]),
    );
  });

  it('keeps a cursor valid across pages when no document matches', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 40, documents: [] };
    const api = createTasksApi(fake, config);

    const page = await api.listTasks({ ...ownerScope, cursorAfter: 'd19' });

    expect(page.tasks).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(parsedQueries(fake.listCalls[0])).toEqual(
      expect.arrayContaining([{ method: 'cursorAfter', values: ['d19'] }]),
    );
  });
});

describe('searchTasks', () => {
  it('searches searchText with the caller visibility scope applied', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [storedDocument('hit')] };
    const api = createTasksApi(fake, config);

    await api.searchTasks('pago', ownerScope);

    const queries = parsedQueries(fake.listCalls[0]);
    expect(queries).toEqual(
      expect.arrayContaining([
        { method: 'search', attribute: 'searchText', values: ['pago'] },
        { method: 'equal', attribute: 'createdBy', values: ['user-123'] },
      ]),
    );
  });

  it('returns the unfiltered list for an empty query (spec task-search)', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 2, documents: [storedDocument('a')] };
    const api = createTasksApi(fake, config);

    await api.searchTasks('   ', adminScope);

    const queries = parsedQueries(fake.listCalls[0]);
    expect(hasQuery(queries, 'search')).toBe(false);
    expect(hasQuery(queries, 'limit')).toBe(true);
  });

  it('lets an admin search across all users (spec task-search → Admin search)', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 2,
      documents: [
        storedDocument('a', { createdBy: 'user-a' }),
        storedDocument('b', { createdBy: 'user-b' }),
      ],
    };
    const api = createTasksApi(fake, config);

    const page = await api.searchTasks('pago', adminScope);

    const queries = parsedQueries(fake.listCalls[0]);
    expect(hasQuery(queries, 'search', 'searchText')).toBe(true);
    expect(hasQuery(queries, 'equal', 'createdBy')).toBe(false);
    expect(page.tasks.map((task) => task.createdBy)).toEqual([
      'user-a',
      'user-b',
    ]);
  });
});

describe('updateStatus', () => {
  it('writes only the status field on a legal transition', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    const updated = await api.updateStatus('doc-9', 'open', 'in_progress');

    expect(fake.updateCalls[0]).toMatchObject({
      databaseId: 'agenda',
      collectionId: 'tasks',
      documentId: 'doc-9',
      data: { status: 'in_progress' },
    });
    expect(updated.status).toBe('in_progress');
    expect(updated.$id).toBe('doc-9');
  });

  it('rejects an illegal transition as a typed validation error', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    await expect(api.updateStatus('doc-9', 'open', 'done')).rejects.toMatchObject(
      {
        kind: 'validation',
        message: 'Invalid status transition: open → done',
      },
    );
    expect(fake.updateCalls).toHaveLength(0);
  });

  it('treats terminal statuses as closed for every target', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    await expect(
      api.updateStatus('doc-9', 'done', 'open'),
    ).rejects.toThrow('Invalid status transition');
    await expect(
      api.updateStatus('doc-9', 'cancelled', 'in_progress'),
    ).rejects.toThrow('Invalid status transition');
    expect(fake.updateCalls).toHaveLength(0);
  });
});

describe('domain error mapping (task 3.3)', () => {
  it('maps a 404 from listDocuments to not-found', async () => {
    const fake = new FakeDatabases();
    fake.nextError = {
      code: 404,
      type: 'collection_not_found',
      message: 'Collection not found',
    };
    const api = createTasksApi(fake, config);

    await expect(api.listTasks(adminScope)).rejects.toMatchObject({
      kind: 'not-found',
      message: 'Collection not found',
    });
  });

  it('maps a rejected search query to validation', async () => {
    const fake = new FakeDatabases();
    fake.nextError = {
      code: 400,
      type: 'general_query_invalid',
      message: 'Invalid query: Syntax error',
    };
    const api = createTasksApi(fake, config);

    await expect(api.searchTasks('pago', ownerScope)).rejects.toMatchObject({
      kind: 'validation',
    });
  });

  it('maps an expired session during createTask to session-expired', async () => {
    const fake = new FakeDatabases();
    fake.nextError = {
      code: 401,
      type: 'user_session_expired',
      message: 'Session expired',
    };
    const api = createTasksApi(fake, config);

    const failure = await api.createTask(record).then(
      () => null,
      (error: unknown) => error,
    );

    expect(isDomainError(failure)).toBe(true);
    if (isDomainError(failure)) {
      expect(failure.kind).toBe('session-expired');
    }
  });

  it('wraps unexpected transport failures as unknown, keeping the cause', async () => {
    const fake = new FakeDatabases();
    const transport = new Error('fetch failed');
    fake.nextError = transport;
    const api = createTasksApi(fake, config);

    const failure = await api.listTasks(ownerScope).then(
      () => null,
      (error: unknown) => error,
    );

    expect(isDomainError(failure)).toBe(true);
    if (isDomainError(failure)) {
      expect(failure.kind).toBe('unknown');
      expect(failure.cause).toBe(transport);
    }
  });
});

describe('loadHomeTasks (glue for the `/` route, task 3.4)', () => {
  it('builds the client from the session secret and reads the caller records', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [storedDocument('mine')] };
    const seenSecrets: string[] = [];

    const page = await loadHomeTasks(
      { id: 'user-123' },
      'cookie-secret',
      false,
      {
        config,
        databasesFor: (secret) => {
          seenSecrets.push(secret);
          return fake;
        },
      },
    );

    expect(seenSecrets).toEqual(['cookie-secret']);
    expect(parsedQueries(fake.listCalls[0])).toEqual(
      expect.arrayContaining([
        { method: 'equal', attribute: 'createdBy', values: ['user-123'] },
      ]),
    );
    expect(page.tasks.map((task) => task.$id)).toEqual(['mine']);
    expect(page.nextCursor).toBeNull();
  });

  it('drops the owner filter for admins so `/` shows every record', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 2,
      documents: [
        storedDocument('a', { createdBy: 'user-a' }),
        storedDocument('b', { createdBy: 'user-b' }),
      ],
    };

    const page = await loadHomeTasks(
      { id: 'user-123' },
      'cookie-secret',
      true,
      { config, databasesFor: () => fake },
    );

    expect(hasQuery(parsedQueries(fake.listCalls[0]), 'equal', 'createdBy')).toBe(
      false,
    );
    expect(page.tasks).toHaveLength(2);
  });

  it('runs a scoped keyword search from the home query with the cursor carried over', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [storedDocument('hit')] };

    await loadHomeTasks(
      { id: 'user-123' },
      'cookie-secret',
      false,
      { config, databasesFor: () => fake },
      { q: '  pago ', cursor: 'd19' },
    );

    const queries = parsedQueries(fake.listCalls[0]);
    expect(queries).toEqual(
      expect.arrayContaining([
        { method: 'search', attribute: 'searchText', values: ['pago'] },
        { method: 'equal', attribute: 'createdBy', values: ['user-123'] },
        { method: 'cursorAfter', values: ['d19'] },
      ]),
    );
  });

  it('falls back to the plain list when the home query is blank', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 2, documents: [storedDocument('a')] };

    await loadHomeTasks(
      { id: 'user-123' },
      'cookie-secret',
      false,
      { config, databasesFor: () => fake },
      { q: '   ' },
    );

    const queries = parsedQueries(fake.listCalls[0]);
    expect(hasQuery(queries, 'search')).toBe(false);
    expect(hasQuery(queries, 'limit')).toBe(true);
  });

  it('searches across every user from the home query for admins', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 2,
      documents: [
        storedDocument('a', { createdBy: 'user-a' }),
        storedDocument('b', { createdBy: 'user-b' }),
      ],
    };

    const page = await loadHomeTasks(
      { id: 'admin-1' },
      'cookie-secret',
      true,
      { config, databasesFor: () => fake },
      { q: 'pago' },
    );

    const queries = parsedQueries(fake.listCalls[0]);
    expect(hasQuery(queries, 'search', 'searchText')).toBe(true);
    expect(hasQuery(queries, 'equal', 'createdBy')).toBe(false);
    expect(page.tasks.map((task) => task.createdBy)).toEqual([
      'user-a',
      'user-b',
    ]);
  });
});

describe('loadAdminTasks (glue for the `/admin` route, task 5.1)', () => {
  it('reads every record through the session secret with no owner filter', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 2,
      documents: [
        storedDocument('a', { createdBy: 'user-a' }),
        storedDocument('b', { createdBy: 'user-b' }),
      ],
    };
    const seenSecrets: string[] = [];

    const page = await loadAdminTasks('cookie-secret', {
      config,
      databasesFor: (secret) => {
        seenSecrets.push(secret);
        return fake;
      },
    });

    expect(seenSecrets).toEqual(['cookie-secret']);
    expect(hasQuery(parsedQueries(fake.listCalls[0]), 'equal', 'createdBy')).toBe(
      false,
    );
    expect(page.tasks.map((task) => task.createdBy)).toEqual([
      'user-a',
      'user-b',
    ]);
  });

  it('carries the cursor for the next page and starts clean without one', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [storedDocument('later')] };

    await loadAdminTasks(
      'cookie-secret',
      { config, databasesFor: () => fake },
      { cursor: 'doc-20' },
    );

    expect(parsedQueries(fake.listCalls[0])).toEqual(
      expect.arrayContaining([
        { method: 'cursorAfter', values: ['doc-20'] },
        { method: 'limit', values: [20] },
      ]),
    );

    const fresh = new FakeDatabases();
    fresh.nextList = { total: 1, documents: [storedDocument('first')] };

    await loadAdminTasks('cookie-secret', {
      config,
      databasesFor: () => fresh,
    });

    expect(hasQuery(parsedQueries(fresh.listCalls[0]), 'cursorAfter')).toBe(
      false,
    );
  });
});

describe('admin filters (PR4 task 5.2, spec record-visibility → admin view)', () => {
  it('builds equal queries for every active filter on the admin scope', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [storedDocument('match')] };

    await createTasksApi(fake, config).listTasks({
      admin: true,
      filters: {
        status: 'open',
        type: 'request',
        creatorEmail: 'ana@grupoecotech.com',
      },
    });

    const queries = parsedQueries(fake.listCalls[0]);
    expect(queries).toEqual(
      expect.arrayContaining([
        { method: 'equal', attribute: 'status', values: ['open'] },
        { method: 'equal', attribute: 'type', values: ['request'] },
        {
          method: 'equal',
          attribute: 'createdByEmail',
          values: ['ana@grupoecotech.com'],
        },
      ]),
    );
    expect(hasQuery(queries, 'equal', 'createdBy')).toBe(false);
  });

  it('adds no filter queries when none are set and only one when partial', async () => {
    const unfiltered = new FakeDatabases();
    unfiltered.nextList = { total: 0, documents: [] };

    await createTasksApi(unfiltered, config).listTasks({ admin: true });

    expect(
      parsedQueries(unfiltered.listCalls[0]).some(
        (query) => query.method === 'equal',
      ),
    ).toBe(false);

    const partial = new FakeDatabases();
    partial.nextList = { total: 0, documents: [] };

    await createTasksApi(partial, config).listTasks({
      admin: true,
      filters: { status: 'done' },
    });

    expect(
      parsedQueries(partial.listCalls[0]).filter(
        (query) => query.method === 'equal',
      ),
    ).toEqual([{ method: 'equal', attribute: 'status', values: ['done'] }]);
  });

  it('passes the admin route filters and cursor down into the data layer', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [storedDocument('m')] };

    await loadAdminTasks(
      'cookie-secret',
      { config, databasesFor: () => fake },
      {
        cursor: 'doc-7',
        status: 'in_progress',
        type: 'task',
        creator: 'luis@grupoecotech.com',
      },
    );

    expect(parsedQueries(fake.listCalls[0])).toEqual(
      expect.arrayContaining([
        { method: 'cursorAfter', values: ['doc-7'] },
        { method: 'equal', attribute: 'status', values: ['in_progress'] },
        { method: 'equal', attribute: 'type', values: ['task'] },
        {
          method: 'equal',
          attribute: 'createdByEmail',
          values: ['luis@grupoecotech.com'],
        },
      ]),
    );
  });
});

describe('calendar date range (PR8 task 8.3, spec calendar-view → Month grid)', () => {
  it('emits an inclusive between query when both bounds are set', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [storedDocument('d')] };
    const api = createTasksApi(fake, config);

    await api.listTasks({
      ...ownerScope,
      dateFrom: '2026-09-28',
      dateTo: '2026-11-01',
    });

    const queries = parsedQueries(fake.listCalls[0]);
    expect(queries).toEqual(
      expect.arrayContaining([
        {
          method: 'between',
          attribute: 'date',
          values: ['2026-09-28', '2026-11-01'],
        },
      ]),
    );
  });

  it('uses greaterThanEqual for a lower bound only and lessThanEqual for an upper bound only', async () => {
    const lower = new FakeDatabases();
    lower.nextList = { total: 0, documents: [] };
    await createTasksApi(lower, config).listTasks({
      ...ownerScope,
      dateFrom: '2026-10-01',
    });
    expect(parsedQueries(lower.listCalls[0])).toEqual(
      expect.arrayContaining([
        {
          method: 'greaterThanEqual',
          attribute: 'date',
          values: ['2026-10-01'],
        },
      ]),
    );
    expect(hasQuery(parsedQueries(lower.listCalls[0]), 'lessThanEqual')).toBe(
      false,
    );

    const upper = new FakeDatabases();
    upper.nextList = { total: 0, documents: [] };
    await createTasksApi(upper, config).listTasks({
      ...ownerScope,
      dateTo: '2026-10-15',
    });
    expect(parsedQueries(upper.listCalls[0])).toEqual(
      expect.arrayContaining([
        { method: 'lessThanEqual', attribute: 'date', values: ['2026-10-15'] },
      ]),
    );
    expect(hasQuery(parsedQueries(upper.listCalls[0]), 'greaterThanEqual')).toBe(
      false,
    );
  });

  it('loads the grid range through the session secret, scoped to the owner', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [storedDocument('placed')] };
    const seenSecrets: string[] = [];

    const page = await loadCalendarTasks(
      { id: 'user-123' },
      'cookie-secret',
      false,
      {
        config,
        databasesFor: (secret) => {
          seenSecrets.push(secret);
          return fake;
        },
      },
      { from: '2026-09-28', to: '2026-11-01' },
    );

    expect(seenSecrets).toEqual(['cookie-secret']);
    const queries = parsedQueries(fake.listCalls[0]);
    expect(queries).toEqual(
      expect.arrayContaining([
        {
          method: 'between',
          attribute: 'date',
          values: ['2026-09-28', '2026-11-01'],
        },
        { method: 'equal', attribute: 'createdBy', values: ['user-123'] },
        { method: 'limit', values: [CALENDAR_PAGE_SIZE] },
      ]),
    );
    expect(page.tasks.map((task) => task.$id)).toEqual(['placed']);
  });

  it('does not add an owner filter for admins', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 1,
      documents: [storedDocument('other', { createdBy: 'someone-else' })],
    };

    await loadCalendarTasks(
      { id: 'admin-1' },
      'cookie-secret',
      true,
      { config, databasesFor: () => fake },
      { from: '2026-09-28', to: '2026-11-01' },
    );

    const queries = parsedQueries(fake.listCalls[0]);
    expect(hasQuery(queries, 'between', 'date')).toBe(true);
    expect(hasQuery(queries, 'equal', 'createdBy')).toBe(false);
  });
});
