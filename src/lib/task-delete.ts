import { toDomainError, type DomainErrorKind } from '@/lib/appwrite/errors';
import { SESSION_EXPIRED_REDIRECT } from '@/lib/task-creation';

/**
 * Hard-delete flow — the same shape as `performUpdateTask` (guard →
 * persist → redirect) so the server action stays a thin adapter and every
 * branch is unit-testable (design D5). There is no soft-delete: the operator
 * asked for a definitive removal.
 *
 * Order of branches: local guards (missing id / not the owner and not an
 * admin) → attachment cascade → record delete → success redirect. A cascade
 * failure keeps the record, so nothing is ever left pointing at a missing
 * file; `DomainError.session-expired` bounces to login and every other kind
 * becomes a banner.
 *
 * Reminders need no cascade: the scheduler reads `tasks` rows directly, so a
 * deleted record can never be reminded again.
 */

export const DELETE_SUCCESS_REDIRECT = '/?deleted=1';

/** State the confirm button re-renders with after a failed submission. */
export interface DeleteTaskState {
  /** Banner message for any failure; null before the first attempt. */
  formError: string | null;
}

export const INITIAL_DELETE_STATE: DeleteTaskState = {
  formError: null,
};

/** Advisory ownership + identity of the target document. */
export interface DeleteTaskInput {
  documentId: string;
  /** Owner id as server-rendered in the form — advisory, not trusted. */
  createdBy: string;
}

/** One attachment of the record: metadata row id + stored file id. */
export interface DeleteAttachmentRef {
  documentId: string;
  fileId: string;
}

/** Form-level copy per `DomainError.kind`, plus the two local guards. */
export const DELETE_ERROR_MESSAGES: Record<DomainErrorKind, string> = {
  validation: 'No se pudo eliminar el registro.',
  unauthorized: 'No tienes permiso para eliminar este registro.',
  'not-found':
    'El registro ya no existe. Puede que otro usuario lo haya eliminado.',
  'session-expired': 'Tu sesión ha expirado. Inicia sesión de nuevo.',
  unknown: 'No se pudo eliminar el registro. Intenta de nuevo.',
};

export const DELETE_LOCAL_ERROR_MESSAGES = {
  missingId: 'No se encontró el registro a eliminar.',
  forbidden: 'No tienes permiso para eliminar este registro.',
  attachments:
    'No se pudieron eliminar los archivos adjuntos, así que el registro se conserva. Intenta de nuevo.',
} as const;

/** Injectable edges of the delete flow so units run with hand-written fakes. */
export interface DeleteTaskDeps {
  /** Current user id — decides the owner/admin path. */
  ownerId: string;
  /** Verified admins-team membership (design D2). */
  admin: boolean;
  listAttachments(recordId: string): Promise<DeleteAttachmentRef[]>;
  deleteFile(fileId: string): Promise<void>;
  deleteAttachmentDocument(documentId: string): Promise<void>;
  deleteTask(documentId: string): Promise<void>;
  /** Re-render the button with the given failure banner. */
  onInvalid(state: DeleteTaskState): void;
  /** Navigate — the action wires this to `next/navigation`'s `redirect`. */
  redirect(to: string): void;
}

/** Reports a domain failure, routing an expired session to the login bounce. */
function failDeps(
  deps: DeleteTaskDeps,
  error: unknown,
  message: string,
): void {
  const domain = toDomainError(error);
  if (domain.kind === 'session-expired') {
    deps.redirect(SESSION_EXPIRED_REDIRECT);
    return;
  }
  deps.onInvalid({ formError: message });
}

/**
 * Removes one attachment: file first, then the metadata row, so no row ever
 * points at a missing file. An already-gone file or row is treated as done —
 * the cascade must not stall on something a previous attempt finished.
 *
 * Returns the failure reason, or null when the attachment is fully gone.
 */
async function removeAttachment(
  deps: DeleteTaskDeps,
  attachment: DeleteAttachmentRef,
): Promise<DomainErrorKind | null> {
  try {
    await deps.deleteFile(attachment.fileId);
  } catch (error) {
    const kind = toDomainError(error).kind;
    if (kind !== 'not-found') {
      return kind;
    }
    // Bytes already gone — fall through and drop the row anyway.
  }

  try {
    await deps.deleteAttachmentDocument(attachment.documentId);
  } catch (error) {
    const kind = toDomainError(error).kind;
    // Row already gone → the attachment is fully removed, not a failure.
    return kind === 'not-found' ? null : kind;
  }

  return null;
}

export async function performDeleteTask(
  deps: DeleteTaskDeps,
  input: DeleteTaskInput,
): Promise<void> {
  if (input.documentId === '') {
    deps.onInvalid({
      formError: DELETE_LOCAL_ERROR_MESSAGES.missingId,
    });
    return;
  }

  if (input.createdBy !== deps.ownerId && !deps.admin) {
    deps.onInvalid({
      formError: DELETE_LOCAL_ERROR_MESSAGES.forbidden,
    });
    return;
  }

  let attachments: DeleteAttachmentRef[];
  try {
    attachments = await deps.listAttachments(input.documentId);
  } catch (error) {
    failDeps(
      deps,
      error,
      DELETE_ERROR_MESSAGES[toDomainError(error).kind] ??
        DELETE_ERROR_MESSAGES.unknown,
    );
    return;
  }

  for (const attachment of attachments) {
    const failure = await removeAttachment(deps, attachment);
    if (failure !== null) {
      // Abort BEFORE the record goes: a retry then finishes the cascade.
      deps.onInvalid({
        formError: DELETE_LOCAL_ERROR_MESSAGES.attachments,
      });
      return;
    }
  }

  try {
    await deps.deleteTask(input.documentId);
  } catch (error) {
    failDeps(
      deps,
      error,
      DELETE_ERROR_MESSAGES[toDomainError(error).kind] ??
        DELETE_ERROR_MESSAGES.unknown,
    );
    return;
  }

  deps.redirect(DELETE_SUCCESS_REDIRECT);
}
