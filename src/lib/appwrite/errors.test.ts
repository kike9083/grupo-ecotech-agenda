import { describe, expect, it } from 'vitest';
import { DomainError, isDomainError, toDomainError } from './errors';

/** Structural stand-in for `AppwriteException` — no SDK import needed (design D5). */
function appwriteFailure(
  code: number,
  type: string,
  message: string,
): { code: number; type: string; message: string } {
  return { code, type, message };
}

describe('toDomainError', () => {
  it('maps a 401 session type to session-expired, keeping message and cause', () => {
    const failure = appwriteFailure(
      401,
      'user_session_expired',
      'Session expired',
    );

    const error = toDomainError(failure);

    expect(isDomainError(error)).toBe(true);
    expect(error.kind).toBe('session-expired');
    expect(error.message).toBe('Session expired');
    expect(error.cause).toBe(failure);
  });

  it('maps a generic 401 to unauthorized', () => {
    const error = toDomainError(
      appwriteFailure(401, 'general_unauthorized', 'Missing auth'),
    );

    expect(error.kind).toBe('unauthorized');
  });

  it('maps a 403 permission denial to unauthorized', () => {
    const error = toDomainError(
      appwriteFailure(403, 'general_forbidden', 'Missing permissions'),
    );

    expect(error.kind).toBe('unauthorized');
  });

  it('maps a 400 payload rejection to validation', () => {
    const error = toDomainError(
      appwriteFailure(400, 'document_invalid_format', 'Invalid data'),
    );

    expect(error.kind).toBe('validation');
  });

  it('maps a 404 to not-found', () => {
    const error = toDomainError(
      appwriteFailure(404, 'document_not_found', 'Document not found'),
    );

    expect(error.kind).toBe('not-found');
  });

  it('wraps failures without an Appwrite code as unknown', () => {
    const failure = new Error('socket hang up');

    const error = toDomainError(failure);

    expect(error.kind).toBe('unknown');
    expect(error.message).toBe('socket hang up');
    expect(error.cause).toBe(failure);
  });

  it('returns the same instance for an already-mapped error', () => {
    const original = new DomainError('not-found', 'gone');

    expect(toDomainError(original)).toBe(original);
  });

  it('stringifies non-Error rejections instead of crashing', () => {
    const error = toDomainError('boom');

    expect(error.kind).toBe('unknown');
    expect(error.message).toBe('boom');
  });
});

describe('isDomainError', () => {
  it('recognizes DomainError instances only', () => {
    expect(isDomainError(new DomainError('validation', 'bad'))).toBe(true);
    expect(isDomainError(new Error('bad'))).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });
});
