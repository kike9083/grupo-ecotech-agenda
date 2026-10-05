import type { DomainErrorKind } from '@/lib/appwrite/errors';
import { toDomainError } from '@/lib/appwrite/errors';
import type {
  Attachment,
  AttachmentRecord,
} from '@/lib/appwrite/attachments';
import {
  ATTACHMENT_ERROR_MESSAGES,
  validateAttachment,
  type AttachmentRejectionReason,
} from '@/lib/attachments';

/**
 * Attachment flow (PR6 tasks 6.1–6.2, spec `attachments`): validate → authorize
 * the parent record → write the file and its metadata (rolling the file back
 * when the metadata write fails) → delete file-then-metadata. Every branch is
 * decided here so the route handlers and server action stay thin adapters.
 *
 * Authorization (spec → "Attachment visibility"): the uploader must be the
 * PARENT record's creator or an admin. The stored `ownerId` is always the
 * record owner, so the attachment mirrors the parent's permissions even when
 * an admin uploads on someone else's behalf.
 */

export type AttachmentFailureReason =
  | AttachmentRejectionReason
  | 'unauthorized'
  | 'not-found'
  | DomainErrorKind;

/** Spanish copy for every failure reason (route JSON + inline form). */
export const ATTACHMENT_FAILURE_MESSAGES: Record<
  AttachmentFailureReason,
  string
> = {
  // Rejection copy is shared with the validator so the route's JSON and the
  // form's inline error always state the same cap (verify suggestion 3).
  'too-large': ATTACHMENT_ERROR_MESSAGES['too-large'],
  'unsupported-type': ATTACHMENT_ERROR_MESSAGES['unsupported-type'],
  unauthorized: 'No tienes permiso para modificar los adjuntos de este registro.',
  'not-found': 'No se encontró el registro o el adjunto.',
  'session-expired': 'Tu sesión ha expirado. Inicia sesión de nuevo.',
  validation: 'El archivo no es válido.',
  unknown: 'No se pudo completar la operación. Intenta de nuevo.',
};

/** HTTP status for each failure reason (upload route contract). */
export function attachmentFailureStatus(reason: AttachmentFailureReason): number {
  switch (reason) {
    case 'too-large':
    case 'unsupported-type':
    case 'validation':
      return 400;
    case 'unauthorized':
      return 403;
    case 'not-found':
      return 404;
    case 'session-expired':
      return 401;
    case 'unknown':
      return 500;
  }
}

export interface UploadFileInput {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
}

export interface UploadInput {
  recordId: string;
  /** Uploading user id — compared against the parent record's creator. */
  ownerId: string;
  admin: boolean;
  file: UploadFileInput;
}

export interface UploadDeps {
  /** Parent record's `createdBy`, or null when the caller cannot see it. */
  getRecordOwner(recordId: string): Promise<string | null>;
  createFile(input: {
    name: string;
    type: string;
    bytes: Uint8Array;
    ownerId: string;
  }): Promise<{ fileId: string }>;
  createDocument(record: AttachmentRecord): Promise<Attachment>;
  /** Rollback edge — removes the just-stored file. */
  deleteFile(fileId: string): Promise<void>;
}

export type UploadResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; reason: AttachmentFailureReason };

export async function performUpload(
  deps: UploadDeps,
  input: UploadInput,
): Promise<UploadResult> {
  const validation = validateAttachment(input.file);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  let recordOwner: string | null;
  try {
    recordOwner = await deps.getRecordOwner(input.recordId);
  } catch (error) {
    return { ok: false, reason: toDomainError(error).kind };
  }

  if (recordOwner === null) {
    return { ok: false, reason: 'not-found' };
  }
  if (recordOwner !== input.ownerId && !input.admin) {
    return { ok: false, reason: 'unauthorized' };
  }

  let fileId: string;
  try {
    ({ fileId } = await deps.createFile({
      name: input.file.name,
      type: validation.mimeType,
      bytes: input.file.bytes,
      ownerId: recordOwner,
    }));
  } catch (error) {
    return { ok: false, reason: toDomainError(error).kind };
  }

  try {
    const attachment = await deps.createDocument({
      recordId: input.recordId,
      fileId,
      kind: validation.kind,
      name: input.file.name,
      mimeType: validation.mimeType,
      size: input.file.size,
      ownerId: recordOwner,
    });
    return { ok: true, attachment };
  } catch (error) {
    // Rollback: a metadata failure must not leave an orphan file behind.
    try {
      await deps.deleteFile(fileId);
    } catch {
      // Best effort — the metadata write is what the caller must hear about.
    }
    return { ok: false, reason: toDomainError(error).kind };
  }
}

export interface DeleteInput {
  documentId: string;
  /** Requesting user id — compared against the attachment's owner. */
  ownerId: string;
  admin: boolean;
}

export interface DeleteDeps {
  getAttachment(
    documentId: string,
  ): Promise<{ fileId: string; ownerId: string } | null>;
  deleteFile(fileId: string): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: AttachmentFailureReason };

/**
 * Deletes the stored file FIRST, then the metadata row. If the file delete
 * fails the metadata is kept, so no document ever points at a missing file.
 */
export async function performDelete(
  deps: DeleteDeps,
  input: DeleteInput,
): Promise<DeleteResult> {
  let existing: { fileId: string; ownerId: string } | null;
  try {
    existing = await deps.getAttachment(input.documentId);
  } catch (error) {
    return { ok: false, reason: toDomainError(error).kind };
  }

  if (existing === null) {
    return { ok: false, reason: 'not-found' };
  }
  if (existing.ownerId !== input.ownerId && !input.admin) {
    return { ok: false, reason: 'unauthorized' };
  }

  try {
    await deps.deleteFile(existing.fileId);
    await deps.deleteDocument(input.documentId);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: toDomainError(error).kind };
  }
}

export interface ReadDeps {
  /** Session user id, or null when unauthenticated. */
  getSessionUserId(): Promise<string | null>;
  getAttachmentByFileId(fileId: string): Promise<Attachment | null>;
  readFile(fileId: string): Promise<ArrayBuffer>;
}

export type ReadResult =
  | { status: 401; message: string }
  | { status: 404; message: string }
  | { status: 200; contentType: string; bytes: ArrayBuffer };

/**
 * Authorized read for the proxy (PR7 task 7.2): a missing session is 401, a
 * file the session cannot see is 404 (peer isolation — the session-scoped
 * metadata query returns nothing), and a visible file streams its bytes with
 * the stored MIME type.
 */
export async function performRead(
  deps: ReadDeps,
  fileId: string,
): Promise<ReadResult> {
  if ((await deps.getSessionUserId()) === null) {
    return { status: 401, message: 'No autenticado.' };
  }

  let attachment: Attachment | null;
  try {
    attachment = await deps.getAttachmentByFileId(fileId);
  } catch (error) {
    const domain = toDomainError(error);
    if (domain.kind === 'session-expired') {
      return { status: 401, message: 'Tu sesión ha expirado.' };
    }
    throw domain;
  }

  if (attachment === null) {
    return { status: 404, message: 'Adjunto no encontrado.' };
  }

  const bytes = await deps.readFile(fileId);
  return { status: 200, contentType: attachment.mimeType, bytes };
}
