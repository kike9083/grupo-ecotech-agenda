import { toDomainError, type DomainErrorKind } from '@/lib/appwrite/errors';
import type { Task } from '@/lib/appwrite/tasks';
import {
  buildTaskRecord,
  validateTaskDraft,
  type TaskDraft,
  type TaskFieldErrors,
  type TaskOwner,
  type TaskRecord,
} from '@/lib/validation/task';

/**
 * Create-task flow (PR3 task 4.3, spec `task-registration`): validate →
 * persist → redirect, with every branch decided here so the server action
 * stays a thin adapter and the flow itself is unit-testable (design D5,
 * same pattern as `performLogin`).
 *
 * Branches:
 * - local validation failure → field errors, NO data-layer call
 * - success → `CREATE_SUCCESS_REDIRECT`
 * - `DomainError.session-expired` → `SESSION_EXPIRED_REDIRECT`
 * - other `DomainError.kind` → form-level message, values preserved
 */

export const CREATE_SUCCESS_REDIRECT = '/?created=1';

export const SESSION_EXPIRED_REDIRECT = '/login?error=expired';

/** State the create form re-renders with after a failed submission. */
export interface CreateTaskState {
  fieldErrors: TaskFieldErrors;
  /** Banner message for failures that are not tied to one field. */
  formError: string | null;
  /** Raw submitted values so the form never loses what the user typed. */
  values: TaskDraft;
}

export const INITIAL_CREATE_STATE: CreateTaskState = {
  fieldErrors: {},
  formError: null,
  values: {},
};

/** Form-level copy per `DomainError.kind` (PR2 task 3.5 taxonomy). */
function formErrorMessage(kind: DomainErrorKind): string {
  switch (kind) {
    case 'validation':
      return 'Los datos no son válidos. Revisa el formulario.';
    case 'unauthorized':
      return 'No tienes permiso para crear tareas.';
    case 'not-found':
      return 'No se encontró el recurso. Intenta de nuevo.';
    case 'session-expired':
      // Unreachable: session-expired redirects before this mapping.
      return 'Tu sesión ha expirado. Inicia sesión de nuevo.';
    case 'unknown':
      return 'No se pudo guardar la tarea. Intenta de nuevo.';
  }
}

/** Injectable edges of the create flow so units run with hand-written fakes. */
export interface CreateTaskDeps {
  createTask(record: TaskRecord): Promise<Task>;
  /** Re-render the form with the given state (validation/domain failure). */
  onInvalid(state: CreateTaskState): void;
  /** Navigate — the action wires this to `next/navigation`'s `redirect`. */
  redirect(to: string): void;
}

export async function performCreateTask(
  deps: CreateTaskDeps,
  draft: TaskDraft,
  owner: TaskOwner,
): Promise<void> {
  const result = validateTaskDraft(draft);
  if (!result.ok) {
    deps.onInvalid({
      fieldErrors: result.errors,
      formError: null,
      values: draft,
    });
    return;
  }

  try {
    await deps.createTask(buildTaskRecord(result.value, owner));
  } catch (error) {
    const domain = toDomainError(error);
    if (domain.kind === 'session-expired') {
      deps.redirect(SESSION_EXPIRED_REDIRECT);
      return;
    }
    deps.onInvalid({
      fieldErrors: {},
      formError: formErrorMessage(domain.kind),
      values: draft,
    });
    return;
  }

  deps.redirect(CREATE_SUCCESS_REDIRECT);
}
