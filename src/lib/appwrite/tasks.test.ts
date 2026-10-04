import { describe, expect, it } from 'vitest';
import { isDomainError } from './errors';
import {
  createTasksApi,
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
    return { $id: documentId, ...data };
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
    expect(call.permissions).toEqual([
      'read("user:user-123")',
      'write("user:user-123")',
      'read("team:admins")',
    ]);
  });

  it('returns the created document as a Task without the searchText attribute', async () => {
    const fake = new FakeDatabases();
    const api = createTasksApi(fake, config);

    const task = await api.createTask(record, 'fixed-doc-id');

    expect(fake.createCalls[0].documentId).toBe('fixed-doc-id');
    expect(task).toEqual({
      $id: 'fixed-doc-id',
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
});
