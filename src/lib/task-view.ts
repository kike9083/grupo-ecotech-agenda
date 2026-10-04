import type { TaskPage } from '@/lib/appwrite/tasks';
import type { TaskStatus, TaskType } from '@/lib/validation/task';

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
  }
}

/** Creator attribution shown on every row (required for admins by the spec). */
export function formatCreatedBy(email: string): string {
  return `Creada por: ${email}`;
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
 * Builds the `/` URL for the current list state: the cursor carries the next
 * page (design D3 next-link). Empty pieces are omitted; nothing to carry
 * collapses to the bare route (task 4.2 adds the `q` keyword branch).
 */
export function buildListHref(params: { cursor?: string }): string {
  const query = new URLSearchParams();
  if (params.cursor !== undefined && params.cursor !== '') {
    query.set('cursor', params.cursor);
  }

  const serialized = query.toString();
  return serialized === '' ? '/' : `/?${serialized}`;
}
