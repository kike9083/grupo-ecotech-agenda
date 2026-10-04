import { toDomainError, type DomainErrorKind } from '@/lib/appwrite/errors';
import type { Task } from '@/lib/appwrite/tasks';
import { plainTextFromHtml } from '@/lib/rich-text';
import {
  buildNoteRecord,
  validateNoteDraft,
  type NoteDraft,
  type NoteFieldErrors,
  type NoteRecord,
} from '@/lib/validation/note';
import type { TaskOwner } from '@/lib/validation/task';

/**
 * Create-note flow (PR2 task 2.2, spec `note-capture`): validate → derive the
 * search plain text → persist → redirect, with every branch decided here so
 * the server action stays a thin adapter (same pattern as `performCreateTask`).
 *
 * Branches:
 * - local validation failure → Spanish field errors, NO data-layer call
 * - success → `NOTE_SUCCESS_REDIRECT`
 * - `DomainError.session-expired` → `SESSION_EXPIRED_REDIRECT`
 * - other `DomainError.kind` → form-level message, values preserved
 */

export const NOTE_SUCCESS_REDIRECT = '/?noted=1';

export const SESSION_EXPIRED_REDIRECT = '/login?error=expired';

/** State the note form re-renders with after a failed submission. */
export interface CreateNoteState {
  fieldErrors: NoteFieldErrors;
  /** Banner message for failures that are not tied to one field. */
  formError: string | null;
  /** Raw submitted values so the form never loses what the user typed. */
  values: NoteDraft;
}

export const INITIAL_NOTE_STATE: CreateNoteState = {
  fieldErrors: {},
  formError: null,
  values: {},
};

/** Form-level copy per `DomainError.kind` (PR2 task 3.3 taxonomy). */
function formErrorMessage(kind: DomainErrorKind): string {
  switch (kind) {
    case 'validation':
      return 'Los datos no son válidos. Revisa el formulario.';
    case 'unauthorized':
      return 'No tienes permiso para crear notas.';
    case 'not-found':
      return 'No se encontró el recurso. Intenta de nuevo.';
    case 'session-expired':
      // Unreachable: session-expired redirects before this mapping.
      return 'Tu sesión ha expirado. Inicia sesión de nuevo.';
    case 'unknown':
      return 'No se pudo guardar la nota. Intenta de nuevo.';
  }
}

/** Injectable edges of the create-note flow so units run with fakes (design D5). */
export interface CreateNoteDeps {
  createNote(record: NoteRecord): Promise<Task>;
  /** Re-render the form with the given state (validation/domain failure). */
  onInvalid(state: CreateNoteState): void;
  /** Navigate — the action wires this to `next/navigation`'s `redirect`. */
  redirect(to: string): void;
}

export async function performCreateNote(
  deps: CreateNoteDeps,
  draft: NoteDraft,
  owner: TaskOwner,
): Promise<void> {
  const result = validateNoteDraft(draft);
  if (!result.ok) {
    deps.onInvalid({
      fieldErrors: result.errors,
      formError: null,
      values: draft,
    });
    return;
  }

  const bodyText = plainTextFromHtml(result.value.bodyHtml);

  try {
    await deps.createNote(buildNoteRecord(result.value, owner, bodyText));
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

  deps.redirect(NOTE_SUCCESS_REDIRECT);
}
