/**
 * Home-route query parsing (PR3 task 4.2, spec `task-search`) and admin-route
 * query parsing (PR4 task 5.2, spec `record-visibility` → admin view).
 *
 * The `/?q=&cursor=&created=` and `/admin?status=&type=&creator=&cursor=`
 * URLs are the single source of truth for their lists: server-side search
 * and filters (no client state), cursor pagination, and the create success
 * banner. Pure functions — unit-tested in the node environment.
 */

import {
  TASK_STATUSES,
  TASK_TYPES,
  type TaskStatus,
  type TaskType,
} from '@/lib/validation/task';

/** Shape Next.js hands to a page for `searchParams` (repeated keys become arrays). */
export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface HomeQuery {
  /** Normalized keyword; empty means "plain list" (spec task-search). */
  q: string;
  /** Cursor of the page being displayed; empty on the first page. */
  cursor: string;
  /** True only when `q` survived normalization — drives the no-results state. */
  searching: boolean;
  /** `?created=1` marker set by the task create flow's success redirect. */
  created: boolean;
  /** `?noted=1` marker set by the note create flow's success redirect. */
  noted: boolean;
}

/** First value when a parameter repeats; `undefined` becomes the empty string. */
function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

/**
 * Keyword normalization for the fulltext box: trim the edges and collapse
 * inner whitespace runs. A whitespace-only input becomes `''`, which the
 * data layer already treats as "return the unfiltered list".
 */
export function normalizeSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Reads the home route's query string into a normalized, ready-to-use state. */
export function parseHomeQuery(params: RawSearchParams | undefined): HomeQuery {
  const q = normalizeSearchTerm(firstValue(params?.q));
  const cursor = firstValue(params?.cursor).trim();

  return {
    q,
    cursor,
    searching: q !== '',
    created: firstValue(params?.created) === '1',
    noted: firstValue(params?.noted) === '1',
  };
}

/**
 * Normalized `/admin` query state (PR4 task 5.2): the three filters are
 * validated against their enums (unknown values are dropped, never trusted),
 * the creator is trimmed, and `filtered` tells the view whether any filter
 * actually narrows the list — that flag drives the empty state.
 */
export interface AdminQuery {
  cursor: string;
  status?: TaskStatus;
  type?: TaskType;
  creator: string;
  filtered: boolean;
}

export function parseAdminQuery(
  params: RawSearchParams | undefined,
): AdminQuery {
  const cursor = firstValue(params?.cursor).trim();
  const statusRaw = firstValue(params?.status);
  const typeRaw = firstValue(params?.type);
  const creator = firstValue(params?.creator).trim();

  const status = TASK_STATUSES.includes(statusRaw as TaskStatus)
    ? (statusRaw as TaskStatus)
    : undefined;
  const type = TASK_TYPES.includes(typeRaw as TaskType)
    ? (typeRaw as TaskType)
    : undefined;

  return {
    cursor,
    status,
    type,
    creator,
    filtered: status !== undefined || type !== undefined || creator !== '',
  };
}

/**
 * Builds an `/admin` URL from the current list state (PR4 tasks 5.1–5.2):
 * the cursor carries the next page and the active filters survive across
 * pages (spec `record-visibility` → admin view). Empty pieces are omitted;
 * nothing to carry collapses to the bare route.
 */
export function buildAdminHref(params: {
  cursor?: string;
  status?: TaskStatus;
  type?: TaskType;
  creator?: string;
}): string {
  const query = new URLSearchParams();
  if (params.status !== undefined) {
    query.set('status', params.status);
  }
  if (params.type !== undefined) {
    query.set('type', params.type);
  }
  if (params.creator !== undefined && params.creator !== '') {
    query.set('creator', params.creator);
  }
  if (params.cursor !== undefined && params.cursor !== '') {
    query.set('cursor', params.cursor);
  }

  const serialized = query.toString();
  return serialized === '' ? '/admin' : `/admin?${serialized}`;
}
