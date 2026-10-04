import { describe, expect, it, vi } from 'vitest';
import type { Task } from './appwrite/tasks';
import {
  INITIAL_STATUS_UPDATE_STATE,
  STATUS_ERROR_MESSAGES,
  parseStatus,
  performStatusUpdate,
  type StatusUpdateDeps,
  type StatusUpdateInput,
} from './task-status';

function taskStub(overrides: Partial<Task> = {}): Task {
  return {
    $id: 'doc-1',
    $createdAt: '2026-10-01T09:00:00.000+00:00',
    type: 'task',
    title: 'Preparar informe',
    description: 'Enviar el informe',
    date: '2026-10-05',
    time: '09:00',
    status: 'in_progress',
    createdBy: 'user-123',
    createdByEmail: 'owner@example.com',
    ...overrides,
  };
}

function depsWith(overrides: Partial<StatusUpdateDeps> = {}): StatusUpdateDeps {
  return {
    ownerId: 'user-123',
    admin: false,
    updateStatus: vi.fn(async () => taskStub()),
    ...overrides,
  };
}

function inputWith(overrides: Partial<StatusUpdateInput> = {}): StatusUpdateInput {
  return {
    documentId: 'doc-1',
    createdBy: 'user-123',
    from: 'open',
    to: 'in_progress',
    ...overrides,
  };
}

describe('parseStatus', () => {
  it('accepts every lifecycle status of the task-registration model', () => {
    expect(parseStatus('open')).toBe('open');
    expect(parseStatus('in_progress')).toBe('in_progress');
    expect(parseStatus('done')).toBe('done');
    expect(parseStatus('cancelled')).toBe('cancelled');
  });

  it('rejects unknown, empty and differently-cased values', () => {
    expect(parseStatus('bogus')).toBeNull();
    expect(parseStatus('')).toBeNull();
    expect(parseStatus('OPEN')).toBeNull();
  });
});

describe('performStatusUpdate (spec task-registration → Status lifecycle)', () => {
  it('rejects an illegal transition WITHOUT touching the data layer', async () => {
    const deps = depsWith();

    const result = await performStatusUpdate(
      deps,
      inputWith({ from: 'open', to: 'done' }),
    );

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(deps.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects any move out of a terminal status without touching the data layer', async () => {
    const deps = depsWith();

    const result = await performStatusUpdate(
      deps,
      inputWith({ from: 'done', to: 'in_progress' }),
    );

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(deps.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects malformed document or status input without touching the data layer', async () => {
    const deps = depsWith();

    const result = await performStatusUpdate(
      deps,
      inputWith({ documentId: '', from: 'whenever', to: 'in_progress' }),
    );

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(deps.updateStatus).not.toHaveBeenCalled();
  });

  it('forbids a non-admin from touching a record they do not own, without the data layer', async () => {
    const deps = depsWith();

    const result = await performStatusUpdate(
      deps,
      inputWith({ createdBy: 'someone-else' }),
    );

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
    expect(deps.updateStatus).not.toHaveBeenCalled();
  });

  it('advances the owner record through the session client', async () => {
    const deps = depsWith();

    const result = await performStatusUpdate(deps, inputWith());

    expect(result).toEqual({ ok: true });
    expect(deps.updateStatus).toHaveBeenCalledWith(
      'session',
      'doc-1',
      'open',
      'in_progress',
    );
  });

  it('lets an admin override another user record through the API-key client (design D2)', async () => {
    const deps = depsWith({ admin: true });

    const result = await performStatusUpdate(
      deps,
      inputWith({ createdBy: 'someone-else', from: 'in_progress', to: 'cancelled' }),
    );

    expect(result).toEqual({ ok: true });
    expect(deps.updateStatus).toHaveBeenCalledWith(
      'admin',
      'doc-1',
      'in_progress',
      'cancelled',
    );
  });

  it('keeps an admin own record on the session client — the API-key path is for non-owned writes only', async () => {
    const deps = depsWith({ admin: true });

    const result = await performStatusUpdate(deps, inputWith());

    expect(result).toEqual({ ok: true });
    expect(deps.updateStatus).toHaveBeenCalledWith(
      'session',
      'doc-1',
      'open',
      'in_progress',
    );
  });

  it('maps a data-layer unauthorized failure to its domain kind', async () => {
    const deps = depsWith({
      updateStatus: vi.fn(async () => {
        throw Object.assign(new Error('forbidden'), { code: 403 });
      }),
    });

    const result = await performStatusUpdate(deps, inputWith());

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('maps an expired session to its domain kind so the action can redirect', async () => {
    const deps = depsWith({
      updateStatus: vi.fn(async () => {
        throw Object.assign(new Error('expired'), {
          code: 401,
          type: 'user_session_expired',
        });
      }),
    });

    const result = await performStatusUpdate(deps, inputWith());

    expect(result).toEqual({ ok: false, reason: 'session-expired' });
  });

  it('maps an unexpected transport failure to unknown', async () => {
    const deps = depsWith({
      updateStatus: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });

    const result = await performStatusUpdate(deps, inputWith());

    expect(result).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('status failure copy (Spanish UI constraint)', () => {
  it('gives every failure reason a Spanish message', () => {
    expect(STATUS_ERROR_MESSAGES.invalid).toBe(
      'Ese cambio de estado no está permitido.',
    );
    expect(STATUS_ERROR_MESSAGES.forbidden).toBe(
      'No tienes permiso para cambiar esta tarea.',
    );
    expect(STATUS_ERROR_MESSAGES.unauthorized).toBe(
      'No tienes permiso para cambiar esta tarea.',
    );
    expect(STATUS_ERROR_MESSAGES['session-expired']).toBe(
      'Tu sesión ha expirado. Inicia sesión de nuevo.',
    );
    expect(STATUS_ERROR_MESSAGES['not-found']).toBe(
      'No se encontró la tarea. Recarga la página e intenta de nuevo.',
    );
    expect(STATUS_ERROR_MESSAGES.validation).toBe(
      'Los datos no son válidos. Intenta de nuevo.',
    );
    expect(STATUS_ERROR_MESSAGES.unknown).toBe(
      'No se pudo actualizar el estado. Intenta de nuevo.',
    );
  });

  it('starts the form in a message-free state', () => {
    expect(INITIAL_STATUS_UPDATE_STATE).toEqual({ message: null });
  });
});
