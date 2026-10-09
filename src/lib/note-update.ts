import { toDomainError, type DomainErrorKind } from '@/lib/appwrite/errors';
import type { Task } from '@/lib/appwrite/tasks';
import { SESSION_EXPIRED_REDIRECT } from '@/lib/note-creation';
import { plainTextFromHtml } from '@/lib/rich-text';
import {
  buildNoteUpdate,
  validateNoteDraft,
  type EditableNoteRecord,
  type NoteDraft,
  type NoteFieldErrors,
} from '@/lib/validation/note';

/**
 * Edit-note flow — the same shape as `performCreateNote` and
 * `performUpdateTask` (guards → validate → persist → redirect) so the server
 * action stays a thin adapter and every branch is unit-testable (design D5).
 *
 * Notes are stranded without it: the task path validates a required `HH:MM`
 * that a note stores as `''`, and `buildTaskUpdate` cannot carry `bodyHtml`.
 *
 * Branches, in order:
 * - no `documentId`, or a non-owner without the admin flag → form banner,
 *   NO data-layer call (the form posts `createdBy` only as an advisory hint;
 *   Appwrite document permissions are the enforcement backstop)
 * - local validation failure → field errors, NO data-layer call
 * - success → `NOTE_UPDATE_SUCCESS_REDIRECT`
 * - `DomainError.session-expired` → `SESSION_EXPIRED_REDIRECT`
 * - other `DomainError.kind` → form-level message, values preserved
 */

/** Same marker the task edit uses — `/` already renders its banner. */
export const NOTE_UPDATE_SUCCESS_REDIRECT = '/?updated=1';

/** State the note form re-renders with after a failed submission. */
export interface UpdateNoteState {
  fieldErrors: NoteFieldErrors;
  /** Banner message for failures that are not tied to one field. */
  formError: string | null;
  /** Raw submitted values so the form never loses what the user typed. */
  values: NoteDraft;
}

export const INITIAL_UPDATE_NOTE_STATE: UpdateNoteState = {
  fieldErrors: {},
  formError: null,
  values: {},
};

/** Advisory ownership + identity of the target document. */
export interface UpdateNoteInput {
  documentId: string;
  /** Owner id as server-rendered in the form — advisory, not trusted. */
  createdBy: string;
}

/** Form-level copy per `DomainError.kind`, plus the two local guards. */
export const UPDATE_NOTE_ERROR_MESSAGES: Record<DomainErrorKind, string> = {
  validation: 'Los datos no son válidos. Revisa el formulario.',
  unauthorized: 'No tienes permiso para editar esta nota.',
  'not-found':
    'No se encontró la nota. Puede que se haya eliminado; vuelve a la lista.',
  'session-expired': 'Tu sesión ha expirado. Inicia sesión de nuevo.',
  unknown: 'No se pudieron guardar los cambios. Intenta de nuevo.',
};

export const UPDATE_NOTE_LOCAL_ERROR_MESSAGES = {
  missingId: 'No se encontró la nota a editar.',
  forbidden: 'No tienes permiso para editar esta nota.',
} as const;

/** Injectable edges of the edit flow so units run with hand-written fakes. */
export interface UpdateNoteDeps {
  /** Current user id — decides the owner/admin path. */
  ownerId: string;
  /** Verified admins-team membership (design D2). */
  admin: boolean;
  updateNote(documentId: string, record: EditableNoteRecord): Promise<Task>;
  /** Re-render the form with the given state (local/domain failure). */
  onInvalid(state: UpdateNoteState): void;
  /** Navigate — the action wires this to `next/navigation`'s `redirect`. */
  redirect(to: string): void;
}

export async function performUpdateNote(
  deps: UpdateNoteDeps,
  input: UpdateNoteInput,
  draft: NoteDraft,
): Promise<void> {
  if (input.documentId === '') {
    deps.onInvalid({
      fieldErrors: {},
      formError: UPDATE_NOTE_LOCAL_ERROR_MESSAGES.missingId,
      values: draft,
    });
    return;
  }

  if (input.createdBy !== deps.ownerId && !deps.admin) {
    deps.onInvalid({
      fieldErrors: {},
      formError: UPDATE_NOTE_LOCAL_ERROR_MESSAGES.forbidden,
      values: draft,
    });
    return;
  }

  const result = validateNoteDraft(draft);
  if (!result.ok) {
    deps.onInvalid({
      fieldErrors: result.errors,
      formError: null,
      values: draft,
    });
    return;
  }

  try {
    await deps.updateNote(
      input.documentId,
      buildNoteUpdate(result.value, plainTextFromHtml(result.value.bodyHtml)),
    );
  } catch (error) {
    const domain = toDomainError(error);
    if (domain.kind === 'session-expired') {
      deps.redirect(SESSION_EXPIRED_REDIRECT);
      return;
    }
    deps.onInvalid({
      fieldErrors: {},
      formError: UPDATE_NOTE_ERROR_MESSAGES[domain.kind],
      values: draft,
    });
    return;
  }

  deps.redirect(NOTE_UPDATE_SUCCESS_REDIRECT);
}
