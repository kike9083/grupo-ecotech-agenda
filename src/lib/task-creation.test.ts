import { describe, expect, it } from 'vitest';
import type { Task } from '@/lib/appwrite/tasks';
import type { TaskDraft, TaskRecord } from '@/lib/validation/task';
import {
  CREATE_SUCCESS_REDIRECT,
  INITIAL_CREATE_STATE,
  SESSION_EXPIRED_REDIRECT,
  performCreateTask,
  type CreateTaskDeps,
  type CreateTaskState,
} from './task-creation';

const owner = { id: 'user-123', email: 'ana@grupoecotech.com' };

const validDraft: TaskDraft = {
  type: 'task',
  title: 'Preparar informe',
  description: 'Enviar el informe de octubre',
  date: '2026-10-05',
  time: '09:30',
};

/** Records every dependency call so assertions cover the whole flow (design D5). */
function makeDeps(
  createTask?: (record: TaskRecord) => Promise<Task>,
): CreateTaskDeps & {
  invalid: CreateTaskState[];
  redirects: string[];
  created: TaskRecord[];
} {
  const invalid: CreateTaskState[] = [];
  const redirects: string[] = [];
  const created: TaskRecord[] = [];

  return {
    invalid,
    redirects,
    created,
    createTask: async (record) => {
      created.push(record);
      if (createTask !== undefined) {
        return createTask(record);
      }
      return {
        $id: 'doc-1',
        $createdAt: '2026-10-01T09:00:00.000+00:00',
        type: record.type,
        title: record.title,
        description: record.description,
        date: record.date,
        time: record.time,
        status: record.status,
        createdBy: record.createdBy,
        createdByEmail: record.createdByEmail,
      };
    },
    onInvalid: (state) => {
      invalid.push(state);
    },
    redirect: (to) => {
      redirects.push(to);
    },
  };
}

describe('performCreateTask', () => {
  it('blocks an invalid draft with field errors and never touches the data layer', async () => {
    const deps = makeDeps();
    const draft: TaskDraft = {
      type: 'task',
      title: '   ',
      description: 'sin título válido',
      date: '2026-10-05',
      time: '09:30',
    };

    await performCreateTask(deps, draft, owner);

    expect(deps.created).toEqual([]);
    expect(deps.redirects).toEqual([]);
    expect(deps.invalid).toHaveLength(1);
    expect(deps.invalid[0].fieldErrors.title).toBe('El título es obligatorio.');
    expect(deps.invalid[0].formError).toBeNull();
    // Values come back so the form can re-render what the user typed.
    expect(deps.invalid[0].values).toEqual(draft);
  });

  it('stores a valid draft as the session owner and redirects home with success', async () => {
    const deps = makeDeps();

    await performCreateTask(deps, validDraft, owner);

    expect(deps.invalid).toEqual([]);
    expect(deps.created).toHaveLength(1);
    expect(deps.created[0]).toEqual({
      type: 'task',
      title: 'Preparar informe',
      description: 'Enviar el informe de octubre',
      date: '2026-10-05',
      time: '09:30',
      status: 'open',
      createdBy: 'user-123',
      createdByEmail: 'ana@grupoecotech.com',
      searchText: 'Preparar informe Enviar el informe de octubre',
    });
    expect(deps.redirects).toEqual([CREATE_SUCCESS_REDIRECT]);
    expect(CREATE_SUCCESS_REDIRECT).toBe('/?created=1');
  });

  it('keeps a past date unchanged (spec task-registration → Backfill)', async () => {
    const deps = makeDeps();

    await performCreateTask(deps, { ...validDraft, date: '2020-01-15' }, owner);

    expect(deps.created[0].date).toBe('2020-01-15');
    expect(deps.redirects).toEqual([CREATE_SUCCESS_REDIRECT]);
  });

  it('re-renders with a banner when the data layer rejects the record (DomainError validation)', async () => {
    const deps = makeDeps(async () => {
      throw { code: 400, type: 'document_invalid_data', message: 'bad data' };
    });

    await performCreateTask(deps, validDraft, owner);

    expect(deps.redirects).toEqual([]);
    expect(deps.invalid).toHaveLength(1);
    expect(deps.invalid[0].fieldErrors).toEqual({});
    expect(deps.invalid[0].formError).toBe(
      'Los datos no son válidos. Revisa el formulario.',
    );
    expect(deps.invalid[0].values).toEqual(validDraft);
  });

  it('redirects to the login recovery route when the session expired mid-request', async () => {
    const deps = makeDeps(async () => {
      throw { code: 401, type: 'user_session_expired', message: 'expired' };
    });

    await performCreateTask(deps, validDraft, owner);

    expect(deps.redirects).toEqual([SESSION_EXPIRED_REDIRECT]);
    expect(SESSION_EXPIRED_REDIRECT).toBe('/login?error=expired');
    expect(deps.invalid).toEqual([]);
  });

  it('surfaces an access message for an unauthorized failure (DomainError unauthorized)', async () => {
    const deps = makeDeps(async () => {
      throw { code: 403, type: 'user_unauthorized', message: 'forbidden' };
    });

    await performCreateTask(deps, validDraft, owner);

    expect(deps.redirects).toEqual([]);
    expect(deps.invalid[0].formError).toBe(
      'No tienes permiso para crear tareas.',
    );
  });

  it('maps a missing-resource failure to its own message (DomainError not-found)', async () => {
    const deps = makeDeps(async () => {
      throw { code: 404, type: 'collection_not_found', message: 'gone' };
    });

    await performCreateTask(deps, validDraft, owner);

    expect(deps.invalid[0].formError).toBe(
      'No se encontró el recurso. Intenta de nuevo.',
    );
  });

  it('falls back to a generic save message for unexpected transport failures', async () => {
    const deps = makeDeps(async () => {
      throw new Error('fetch failed');
    });

    await performCreateTask(deps, validDraft, owner);

    expect(deps.invalid[0].formError).toBe(
      'No se pudo guardar la tarea. Intenta de nuevo.',
    );
    expect(deps.invalid[0].fieldErrors).toEqual({});
  });

  it('collects every field error from one pass over a fully broken draft', async () => {
    const deps = makeDeps();

    await performCreateTask(
      deps,
      { type: 'bogus', title: '', date: '2026-13-01', time: '9:00' },
      owner,
    );

    expect(deps.created).toEqual([]);
    expect(Object.keys(deps.invalid[0].fieldErrors).sort()).toEqual([
      'date',
      'time',
      'title',
      'type',
    ]);
  });

  it('exports an empty initial state for the form to start from', () => {
    expect(INITIAL_CREATE_STATE).toEqual({
      fieldErrors: {},
      formError: null,
      values: {},
    });
  });
});
