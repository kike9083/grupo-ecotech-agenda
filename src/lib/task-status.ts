/**
 * Status-update flow (PR4 task 5.2, spec `task-registration` → "Status
 * lifecycle" + `record-visibility` → owner write).
 *
 * The form posts only advisory fields (documentId, createdBy, from, to) —
 * Appwrite document permissions are the enforcement backstop, and this
 * module rejects locally BEFORE any data-layer call when:
 * - the input is malformed (unknown status, empty id), or
 * - the transition is not in the lifecycle matrix (`canTransition`), or
 * - a non-admin tries to touch a record they do not own.
 *
 * Client choice (design D2): the owner always writes through the session
 * client (Appwrite enforces the owner permission); an admin on a record
 * they don't own goes through the API-key client as an explicit override.
 */

import { toDomainError, type DomainErrorKind } from '@/lib/appwrite/errors';
import type { Task } from '@/lib/appwrite/tasks';
import {
  TASK_STATUSES,
  canTransition,
  type TaskStatus,
} from '@/lib/validation/task';

/** Which Appwrite client performed the write — session always wins for owners. */
export type StatusUpdateClient = 'session' | 'admin';

export interface StatusUpdateInput {
  documentId: string;
  /** Owner id as server-rendered in the form — advisory, not trusted. */
  createdBy: string;
  from: string;
  to: string;
}

export type StatusFailureReason = 'invalid' | 'forbidden' | DomainErrorKind;

export type StatusUpdateResult =
  | { ok: true }
  | { ok: false; reason: StatusFailureReason };

export interface StatusUpdateDeps {
  /** Current user id — decides the owner path. */
  ownerId: string;
  /** Verified admins-team membership (design D2). */
  admin: boolean;
  updateStatus(
    client: StatusUpdateClient,
    documentId: string,
    from: TaskStatus,
    to: TaskStatus,
  ): Promise<Task>;
}

/** Spanish copy for every failure reason (UI language constraint). */
export const STATUS_ERROR_MESSAGES: Record<StatusFailureReason, string> = {
  invalid: 'Ese cambio de estado no está permitido.',
  forbidden: 'No tienes permiso para cambiar esta tarea.',
  unauthorized: 'No tienes permiso para cambiar esta tarea.',
  'session-expired': 'Tu sesión ha expirado. Inicia sesión de nuevo.',
  'not-found': 'No se encontró la tarea. Recarga la página e intenta de nuevo.',
  validation: 'Los datos no son válidos. Intenta de nuevo.',
  unknown: 'No se pudo actualizar el estado. Intenta de nuevo.',
};

export interface StatusUpdateState {
  message: string | null;
}

export const INITIAL_STATUS_UPDATE_STATE: StatusUpdateState = { message: null };

/** Narrow a raw form string to a lifecycle status, or null if unknown. */
export function parseStatus(value: string): TaskStatus | null {
  return TASK_STATUSES.includes(value as TaskStatus)
    ? (value as TaskStatus)
    : null;
}

export async function performStatusUpdate(
  deps: StatusUpdateDeps,
  input: StatusUpdateInput,
): Promise<StatusUpdateResult> {
  const from = parseStatus(input.from);
  const to = parseStatus(input.to);

  if (
    input.documentId === '' ||
    from === null ||
    to === null ||
    !canTransition(from, to)
  ) {
    return { ok: false, reason: 'invalid' };
  }

  const owner = input.createdBy === deps.ownerId;
  if (!owner && !deps.admin) {
    return { ok: false, reason: 'forbidden' };
  }

  try {
    await deps.updateStatus(
      owner ? 'session' : 'admin',
      input.documentId,
      from,
      to,
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: toDomainError(error).kind };
  }
}
