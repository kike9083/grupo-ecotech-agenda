import { toDomainError, type DomainErrorKind } from '@/lib/appwrite/errors';
import type { Task } from '@/lib/appwrite/tasks';
import { SESSION_EXPIRED_REDIRECT } from '@/lib/task-creation';
import {
  buildTaskUpdate,
  validateTaskDraft,
  type EditableTaskRecord,
  type TaskDraft,
  type TaskFieldErrors,
} from '@/lib/validation/task';

/**
 * Edit-record flow — the same shape as `performCreateTask` (validate →
 * persist → redirect) so the server action stays a thin adapter and every
 * branch is unit-testable (design D5).
 *
 * Branches, in order:
 * - no `documentId`, or a non-owner without the admin flag → form banner,
 *   NO data-layer call (the form posts `createdBy` only as an advisory
 *   hint; Appwrite document permissions are the enforcement backstop)
 * - local validation failure → field errors, NO data-layer call
 * - success → `UPDATE_SUCCESS_REDIRECT`
 * - `DomainError.session-expired` → `SESSION_EXPIRED_REDIRECT`
 * - other `DomainError.kind` → form-level message, values preserved
 */

export const UPDATE_SUCCESS_REDIRECT = '/?updated=1';

/** State the edit form re-renders with after a failed submission. */
export interface UpdateTaskState {
  fieldErrors: TaskFieldErrors;
  /** Banner message for failures that are not tied to one field. */
  formError: string | null;
  /** Raw submitted values so the form never loses what the user typed. */
  values: TaskDraft;
}

export const INITIAL_UPDATE_STATE: UpdateTaskState = {
  fieldErrors: {},
  formError: null,
  values: {},
};

/** Advisory ownership + identity of the target document. */
export interface UpdateTaskInput {
  documentId: string;
  /** Owner id as server-rendered in the form — advisory, not trusted. */
  createdBy: string;
}

/** Form-level copy per `DomainError.kind`, plus the two local guards. */
export const UPDATE_ERROR_MESSAGES: Record<DomainErrorKind, string> = {
  validation: 'Los datos no son válidos. Revisa el formulario.',
  unauthorized: 'No tienes permiso para editar este registro.',
  'not-found':
    'No se encontró el registro. Puede que se haya eliminado; vuelve a la lista.',
  'session-expired': 'Tu sesión ha expirado. Inicia sesión de nuevo.',
  unknown: 'No se pudieron guardar los cambios. Intenta de nuevo.',
};

export const UPDATE_LOCAL_ERROR_MESSAGES = {
  missingId: 'No se encontró el registro a editar.',
  forbidden: 'No tienes permiso para editar este registro.',
} as const;

/** Injectable edges of the edit flow so units run with hand-written fakes. */
export interface UpdateTaskDeps {
  /** Current user id — decides the owner/admin path. */
  ownerId: string;
  /** Verified admins-team membership (design D2). */
  admin: boolean;
  updateTask(
    documentId: string,
    record: EditableTaskRecord,
  ): Promise<Task>;
  /** Re-render the form with the given state (local/domain failure). */
  onInvalid(state: UpdateTaskState): void;
  /** Navigate — the action wires this to `next/navigation`'s `redirect`. */
  redirect(to: string): void;
}

export async function performUpdateTask(
  deps: UpdateTaskDeps,
  input: UpdateTaskInput,
  draft: TaskDraft,
): Promise<void> {
  if (input.documentId === '') {
    deps.onInvalid({
      fieldErrors: {},
      formError: UPDATE_LOCAL_ERROR_MESSAGES.missingId,
      values: draft,
    });
    return;
  }

  if (input.createdBy !== deps.ownerId && !deps.admin) {
    deps.onInvalid({
      fieldErrors: {},
      formError: UPDATE_LOCAL_ERROR_MESSAGES.forbidden,
      values: draft,
    });
    return;
  }

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
    await deps.updateTask(input.documentId, buildTaskUpdate(result.value));
  } catch (error) {
    const domain = toDomainError(error);
    if (domain.kind === 'session-expired') {
      deps.redirect(SESSION_EXPIRED_REDIRECT);
      return;
    }
    deps.onInvalid({
      fieldErrors: {},
      formError: UPDATE_ERROR_MESSAGES[domain.kind],
      values: draft,
    });
    return;
  }

  deps.redirect(UPDATE_SUCCESS_REDIRECT);
}
