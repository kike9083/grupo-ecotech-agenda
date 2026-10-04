import type { TaskPage } from '@/lib/appwrite/tasks';
import {
  TASK_STATUSES,
  canTransition,
  type TaskStatus,
  type TaskType,
} from '@/lib/validation/task';

/**
 * Presentational helpers for the task list (PR3 task 4.1, spec `task-listing`).
 *
 * Pure functions only — the RSC page and `TaskList` component are validated
 * by `tsc`/`next build`; every branch a user can see is decided here so it
 * stays unit-testable in the node environment (design D5).
 */

export const LOAD_ERROR_MESSAGE =
  'No se pudieron cargar las tareas. Intenta de nuevo más tarde.';

export const RETRY_LABEL = 'Reintentar';

export const NEXT_PAGE_LABEL = 'Cargar más';

/** Badge label for a lifecycle status (spec `task-listing`). */
export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'open':
      return 'Abierta';
    case 'in_progress':
      return 'En curso';
    case 'done':
      return 'Completada';
    case 'cancelled':
      return 'Cancelada';
  }
}

/** Badge label for a record type. */
export function typeLabel(type: TaskType): string {
  switch (type) {
    case 'task':
      return 'Tarea';
    case 'request':
      return 'Solicitud';
    case 'note':
      return 'Nota';
  }
}

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/**
 * Spanish creation-timestamp copy for a note (spec `note-capture` → "Creation
 * timestamp display"): "Anotado el 4 de octubre de 2026". Reads the date part
 * of the Appwrite `$createdAt` ISO string directly (no `Date`/timezone shift)
 * and falls back to the raw value when it is not an ISO timestamp.
 */
export function formatNotedAt(createdAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(createdAt);
  if (match === null) {
    return `Anotado el ${createdAt}`;
  }

  const [, year, month, day] = match;
  const monthName = MONTHS_ES[Number(month) - 1] ?? month;

  return `Anotado el ${Number(day)} de ${monthName} de ${year}`;
}

/**
 * Buttons a row should offer for its current status (PR4 task 5.2, spec
 * `task-registration` → "Status lifecycle"): derived from the same
 * `canTransition` matrix the action enforces, so the UI can never offer an
 * illegal move. Terminal records get no controls.
 */
export function allowedTransitions(from: TaskStatus): TaskStatus[] {
  return TASK_STATUSES.filter((to) => canTransition(from, to));
}

/** Spanish label for a transition submit button. */
export function statusActionLabel(to: TaskStatus): string {
  switch (to) {
    case 'open':
      return 'Reabrir';
    case 'in_progress':
      return 'Iniciar';
    case 'done':
      return 'Completar';
    case 'cancelled':
      return 'Cancelar';
  }
}

/** Creator attribution shown on every row (required for admins by the spec). */
export function formatCreatedBy(email: string): string {
  return `Creada por: ${email}`;
}

export const NOTE_SNIPPET_MAX_LENGTH = 120;

export const NOTE_EMPTY_HEADING = 'Nota sin contenido';

/**
 * One-line preview of a note body (spec `task-listing` → "includes notes"):
 * trims the plain text and truncates it to a single line with an ellipsis.
 */
export function noteSnippet(
  text: string,
  maxLength: number = NOTE_SNIPPET_MAX_LENGTH,
): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Heading for a note row: the title when the author gave one, otherwise the
 * body snippet, otherwise a placeholder for a completely empty note.
 */
export function noteHeading(title: string, snippet: string): string {
  if (title.trim() !== '') {
    return title;
  }
  return snippet !== '' ? snippet : NOTE_EMPTY_HEADING;
}

/**
 * Which of the three distinct list states the page should render
 * (spec `task-listing` → "UI states"): error, empty, or results.
 * Returned as a discriminated union so consumers narrow without casts.
 */
export type ListState =
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'results'; page: TaskPage };

export function resolveListState(page: TaskPage | null): ListState {
  if (page === null) {
    return { kind: 'error' };
  }
  if (page.tasks.length === 0) {
    return { kind: 'empty' };
  }
  return { kind: 'results', page };
}

/** Empty-state copy differs between the plain list and a keyword search. */
export function emptyMessage(options: { searching: boolean }): string {
  return options.searching ? 'Sin resultados.' : 'No hay tareas todavía.';
}

/**
 * Empty-state copy for the admin view (PR4 task 5.2): an unfiltered empty
 * list invites creating records, a filtered one points back at the filters.
 */
export function adminEmptyMessage(options: { filtered: boolean }): string {
  return options.filtered
    ? 'Sin resultados para los filtros aplicados.'
    : 'No hay tareas todavía.';
}

/**
 * Builds an `/` URL from the current query state: the cursor carries the
 * next page (design D3 next-link), `q` keeps a keyword search alive across
 * pages and `from`/`to` keep the date range alive (spec `task-search`).
 * Empty pieces are omitted; nothing to carry collapses to the bare route.
 */
export function buildListHref(params: {
  cursor?: string;
  q?: string;
  from?: string;
  to?: string;
}): string {
  const query = new URLSearchParams();
  if (params.q !== undefined && params.q !== '') {
    query.set('q', params.q);
  }
  if (params.from !== undefined && params.from !== '') {
    query.set('from', params.from);
  }
  if (params.to !== undefined && params.to !== '') {
    query.set('to', params.to);
  }
  if (params.cursor !== undefined && params.cursor !== '') {
    query.set('cursor', params.cursor);
  }

  const serialized = query.toString();
  return serialized === '' ? '/' : `/?${serialized}`;
}
