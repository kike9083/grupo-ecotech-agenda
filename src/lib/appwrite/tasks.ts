import { ID, Permission, Query, Role } from 'node-appwrite';
import {
  canTransition,
  type TaskRecord,
  type TaskStatus,
  type TaskType,
} from '@/lib/validation/task';
import { DomainError, toDomainError } from './errors';

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
/**
 * Optional filters of the admin view (PR4 task 5.2): status, type and
 * creator — only the admin branch of the scope can carry them; a member's
 * scope stays owner-only, double-enforced.
 */
export interface TaskFilters {
  status?: TaskStatus;
  type?: TaskType;
  /** Exact `createdByEmail` match — the human-facing creator filter. */
  creatorEmail?: string;
}

export type TaskScope =
  | { admin: true; cursorAfter?: string; filters?: TaskFilters }
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
  if (scope.admin && scope.filters !== undefined) {
    const { status, type, creatorEmail } = scope.filters;
    if (status !== undefined) {
      queries.push(Query.equal('status', status));
    }
    if (type !== undefined) {
      queries.push(Query.equal('type', type));
    }
    if (creatorEmail !== undefined) {
      queries.push(Query.equal('createdByEmail', creatorEmail));
    }
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
      try {
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
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Cursor-paginated list for the caller's scope (spec `task-listing`). */
    async listTasks(scope: TaskScope): Promise<TaskPage> {
      try {
        const result = await databases.listDocuments(
          config.databaseId,
          config.collectionId,
          listQueries(scope),
        );
        return toPage(result);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /**
     * Fulltext keyword search on `searchText` (spec `task-search`): a blank
     * query returns the unfiltered list, and results stay scoped exactly like
     * `listTasks`.
     */
    async searchTasks(q: string, scope: TaskScope): Promise<TaskPage> {
      try {
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
      } catch (error) {
        throw toDomainError(error);
      }
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
        // A domain error thrown on purpose: PR3 actions branch on `kind`.
        throw new DomainError(
          'validation',
          `Invalid status transition: ${from} → ${to}`,
        );
      }

      try {
        const doc = await databases.updateDocument(
          config.databaseId,
          config.collectionId,
          documentId,
          { status: to },
        );
        return toTask(doc);
      } catch (error) {
        throw toDomainError(error);
      }
    },
  };
}

export type TasksApi = ReturnType<typeof createTasksApi>;

/** Injectable edges of the `/` home route (task 3.4, design D5). */
export interface HomeTasksDeps {
  config: TasksConfig;
  /** Builds the session-scoped `Databases` from the `aw_session` secret. */
  databasesFor(secret: string): DatabasesLike;
}

/** Normalized `/?q=&cursor=` state the home route passes down (task 4.2). */
export interface HomeListParams {
  /** Keyword from the search box — empty or absent means the plain list. */
  q?: string;
  /** Cursor of the page being displayed — continuation of the current page. */
  cursor?: string;
}

/**
 * Server-side results for the home route: resolves the caller's scope (admins
 * see everything, users only their own — spec `record-visibility`) and runs
 * `searchTasks` when the query carries a keyword, `listTasks` otherwise — both
 * through a client built from the caller's session secret, so Appwrite
 * enforces document permissions on top of the query filter.
 *
 * Kept out of the page component so this wiring is unit-testable without
 * mocking `next/headers` (the page itself is covered by build + smoke).
 */
export async function loadHomeTasks(
  user: { id: string },
  sessionSecret: string,
  admin: boolean,
  deps: HomeTasksDeps,
  params: HomeListParams = {},
): Promise<TaskPage> {
  const api = createTasksApi(deps.databasesFor(sessionSecret), deps.config);
  const scope: TaskScope = admin
    ? { admin: true }
    : { admin: false, ownerId: user.id };

  const cursor = params.cursor ?? '';
  if (cursor !== '') {
    scope.cursorAfter = cursor;
  }

  const term = (params.q ?? '').trim();
  if (term !== '') {
    return api.searchTasks(term, scope);
  }
  return api.listTasks(scope);
}

/** Normalized `/admin?…` state the admin route passes down (tasks 5.1–5.2). */
export interface AdminListParams {
  /** Cursor of the page being displayed — continuation of the current page. */
  cursor?: string;
  /** Active `status` filter, already validated against the enum. */
  status?: TaskStatus;
  /** Active `type` filter, already validated against the enum. */
  type?: TaskType;
  /** Creator filter as typed by the admin — matched exactly on `createdByEmail`. */
  creator?: string;
}

/**
 * Server-side results for the `/admin` route: always the full all-records
 * scope — visibility comes from the `team:admins` read permission, so NO
 * owner filter is ever added (spec `record-visibility` → "Admin read").
 * Optional status/type/creator filters narrow the query server-side. Runs
 * through a client built from the caller's session secret, exactly like the
 * home route; the API-key client stays reserved for admin WRITES
 * (design D2).
 */
export async function loadAdminTasks(
  sessionSecret: string,
  deps: HomeTasksDeps,
  params: AdminListParams = {},
): Promise<TaskPage> {
  const api = createTasksApi(deps.databasesFor(sessionSecret), deps.config);

  const filters: TaskFilters = {};
  if (params.status !== undefined) {
    filters.status = params.status;
  }
  if (params.type !== undefined) {
    filters.type = params.type;
  }
  if (params.creator !== undefined && params.creator !== '') {
    filters.creatorEmail = params.creator;
  }

  const scope: TaskScope = { admin: true, filters };
  const cursor = params.cursor ?? '';
  if (cursor !== '') {
    scope.cursorAfter = cursor;
  }

  return api.listTasks(scope);
}
