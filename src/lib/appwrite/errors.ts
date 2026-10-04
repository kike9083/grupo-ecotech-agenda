/**
 * Typed domain errors for the data layer (PR2 task 3.3).
 *
 * Actions in PR3 branch on `kind` instead of sniffing Appwrite exception
 * shapes: session-expired → clear cookie and bounce to `/login?error=expired`,
 * validation → inline form error, not-found → stale UI state, unauthorized →
 * silent no-op / access message. Everything else funnels to `unknown`.
 *
 * Detection is structural (`code`/`type`/`message`) rather than
 * `instanceof AppwriteException` so tests can feed hand-written failures
 * without importing the SDK (design D5).
 */

export type DomainErrorKind =
  | 'unauthorized'
  | 'session-expired'
  | 'validation'
  | 'not-found'
  | 'unknown';

export class DomainError extends Error {
  readonly kind: DomainErrorKind;

  constructor(kind: DomainErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DomainError';
    this.kind = kind;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

function readCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const { code } = error;
  return typeof code === 'number' ? code : null;
}

function readType(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    return null;
  }
  const { type } = error;
  return typeof type === 'string' ? type : null;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    // Structural failures (fake clients, AppwriteException-like shapes).
    return error.message;
  }
  return String(error);
}

/**
 * Maps any failure raised by an Appwrite call to a `DomainError`:
 *
 * | condition                                   | kind            |
 * |---------------------------------------------|-----------------|
 * | 401 with a `*session*` type (expired/stale) | session-expired |
 * | 401 / 403                                   | unauthorized    |
 * | 400 / 422                                   | validation      |
 * | 404                                         | not-found       |
 * | anything else                               | unknown         |
 *
 * Already-mapped errors pass through untouched so wrappers never nest.
 */
export function toDomainError(error: unknown): DomainError {
  if (isDomainError(error)) {
    return error;
  }

  const code = readCode(error);
  const type = readType(error);
  const message = readMessage(error);

  if (code === 401) {
    const kind =
      type !== null && type.includes('session')
        ? 'session-expired'
        : 'unauthorized';
    return new DomainError(kind, message, error);
  }
  if (code === 403) {
    return new DomainError('unauthorized', message, error);
  }
  if (code === 400 || code === 422) {
    return new DomainError('validation', message, error);
  }
  if (code === 404) {
    return new DomainError('not-found', message, error);
  }

  return new DomainError('unknown', message, error);
}
