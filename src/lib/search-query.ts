/**
 * Home-route query parsing (PR3 task 4.2, spec `task-search`).
 *
 * The `/?q=&cursor=&created=` URL is the single source of truth for the list:
 * server-side search (no client state), cursor pagination, and the create
 * success banner. Pure functions — unit-tested in the node environment.
 */

/** Shape Next.js hands to a page for `searchParams` (repeated keys become arrays). */
export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface HomeQuery {
  /** Normalized keyword; empty means "plain list" (spec task-search). */
  q: string;
  /** Cursor of the page being displayed; empty on the first page. */
  cursor: string;
  /** True only when `q` survived normalization — drives the no-results state. */
  searching: boolean;
  /** `?created=1` marker set by the create flow's success redirect. */
  created: boolean;
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
  };
}

/**
 * Builds an `/admin` URL from the current list state (PR4 task 5.1): the
 * cursor carries the next page of the all-records view. Empty pieces are
 * omitted; nothing to carry collapses to the bare route.
 */
export function buildAdminHref(params: { cursor?: string }): string {
  const query = new URLSearchParams();
  if (params.cursor !== undefined && params.cursor !== '') {
    query.set('cursor', params.cursor);
  }

  const serialized = query.toString();
  return serialized === '' ? '/admin' : `/admin?${serialized}`;
}
