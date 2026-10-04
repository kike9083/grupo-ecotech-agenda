import { ID, Permission, Query, Role } from 'node-appwrite';
import {
  canTransition,
  type TaskRecord,
  type TaskStatus,
  type TaskType,
} from '@/lib/validation/task';

/**
 * `tasks` data access (design D3): one module, an INJECTED client, zero
 * network in tests (design D5 — the fake records calls and asserts query
 * shapes). Every Appwrite call runs server-side.
 *
 * Query strings are the JSON format Appwrite 1.8 accepts (batch-0 gotcha 4):
 * `{"method":"search","attribute":"searchText","values":["q"]}` — the SDK's
 * `Query` helpers already emit exactly that.
 */

/** A stored document as returned by Appwrite: `$id` plus the nine attributes. */
export interface RawDocument {
  $id: string;
  [key: string]: unknown;
}

/** Minimal structural view of `Databases` so tests inject a fake (design D5). */
export interface DatabasesLike {
  createDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: Record<string, unknown>,
    permissions?: string[],
  ): Promise<RawDocument>;
  listDocuments(
    databaseId: string,
    collectionId: string,
    queries?: string[],
  ): Promise<{ total: number; documents: RawDocument[] }>;
  updateDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data?: Record<string, unknown>,
    permissions?: string[],
  ): Promise<RawDocument>;
}

/** Identifiers of the provisioned Appwrite resources (env contract, D4). */
export interface TasksConfig {
  databaseId: string;
  collectionId: string;
  adminsTeamId: string;
}

/**
 * Who is asking (spec `record-visibility`): non-admins are double-enforced to
 * their own records via a `createdBy` query; admins list everything (their
 * visibility comes from the `team:admins` document permission).
 */
export type TaskScope =
  | { admin: true; cursorAfter?: string }
  | { admin: false; ownerId: string; cursorAfter?: string };

/** Read model per design D3 — no `searchText` on the wire to the UI. */
export interface Task {
  $id: string;
  type: TaskType;
  title: string;
  description: string;
  date: string;
  time: string;
  status: TaskStatus;
  createdBy: string;
  createdByEmail: string;
}

export interface TaskPage {
  tasks: Task[];
  /** Last document id of a full page — feed back as `cursorAfter`; null when exhausted. */
  nextCursor: string | null;
}

export const PAGE_SIZE = 20;

function toTask(doc: RawDocument): Task {
  return {
    $id: doc.$id,
    type: doc.type as TaskType,
    title: doc.title as string,
    description: doc.description as string,
    date: doc.date as string,
    time: doc.time as string,
    status: doc.status as TaskStatus,
    createdBy: doc.createdBy as string,
    createdByEmail: doc.createdByEmail as string,
  };
}

function toPage(result: {
  total: number;
  documents: RawDocument[];
}): TaskPage {
  const last = result.documents[result.documents.length - 1];
  return {
    tasks: result.documents.map(toTask),
    nextCursor:
      result.documents.length === PAGE_SIZE && last !== undefined
        ? last.$id
        : null,
  };
}

/**
 * Shared query list: page size 20, date/time/$id descending (design D1 —
 * `$id` is the stable tiebreak for equal date+time rows), plus the
 * caller-scope filter and an optional cursor.
 */
function listQueries(scope: TaskScope): string[] {
  const queries = [
    Query.limit(PAGE_SIZE),
    Query.orderDesc('date'),
    Query.orderDesc('time'),
    Query.orderDesc('$id'),
  ];

  if (!scope.admin) {
    queries.push(Query.equal('createdBy', scope.ownerId));
  }
  if (scope.cursorAfter !== undefined && scope.cursorAfter !== '') {
    queries.push(Query.cursorAfter(scope.cursorAfter));
  }

  return queries;
}

/**
 * Factory that binds an injected `Databases` to the provisioned ids — the
 * session-scoped client for owner paths, the API-key client for admin writes
 * (design D2); this module never constructs either.
 */
export function createTasksApi(
  databases: DatabasesLike,
  config: TasksConfig,
) {
  return {
    /**
     * Persists a validated record (validation module output) with the D1
     * permission shape: creator read+write, admins read. Appwrite 1.8 stores
     * attributes inside `data` and takes the array as `permissions`
     * (gotcha 3); `write(...)` is normalized server-side to update+delete
     * (gotcha 9), so we never assert raw equality on stored permissions.
     */
    async createTask(
      record: TaskRecord,
      documentId: string = ID.unique(),
    ): Promise<Task> {
      const permissions = [
        Permission.read(Role.user(record.createdBy)),
        Permission.write(Role.user(record.createdBy)),
        Permission.read(Role.team(config.adminsTeamId)),
      ];

      const doc = await databases.createDocument(
        config.databaseId,
        config.collectionId,
        documentId,
        { ...record },
        permissions,
      );
      return toTask(doc);
    },

    /** Cursor-paginated list for the caller's scope (spec `task-listing`). */
    async listTasks(scope: TaskScope): Promise<TaskPage> {
      const result = await databases.listDocuments(
        config.databaseId,
        config.collectionId,
        listQueries(scope),
      );
      return toPage(result);
    },

    /**
     * Fulltext keyword search on `searchText` (spec `task-search`): a blank
     * query returns the unfiltered list, and results stay scoped exactly like
     * `listTasks`.
     */
    async searchTasks(q: string, scope: TaskScope): Promise<TaskPage> {
      const term = q.trim();
      if (term === '') {
        return this.listTasks(scope);
      }

      const result = await databases.listDocuments(
        config.databaseId,
        config.collectionId,
        [Query.search('searchText', term), ...listQueries(scope)],
      );
      return toPage(result);
    },

    /**
     * Owner or admin status change (spec `task-registration` → "Status
     * lifecycle"): the matrix is enforced here; WHO may change it is enforced
     * by Appwrite through the injected client's credential — session client
     * for owners, API-key client for admin overrides (design D2).
     */
    async updateStatus(
      documentId: string,
      from: TaskStatus,
      to: TaskStatus,
    ): Promise<Task> {
      if (!canTransition(from, to)) {
        throw new Error(`Invalid status transition: ${from} → ${to}`);
      }

      const doc = await databases.updateDocument(
        config.databaseId,
        config.collectionId,
        documentId,
        { status: to },
      );
      return toTask(doc);
    },
  };
}

export type TasksApi = ReturnType<typeof createTasksApi>;
