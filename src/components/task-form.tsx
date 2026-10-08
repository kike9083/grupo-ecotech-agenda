'use client';

import { useActionState } from 'react';
import { createTaskAction, updateTaskAction } from '@/actions/tasks';
import {
  INITIAL_CREATE_STATE,
  type CreateTaskState,
} from '@/lib/task-creation';
import {
  INITIAL_UPDATE_STATE,
  type UpdateTaskState,
} from '@/lib/task-update';
import {
  DESCRIPTION_MAX_LENGTH,
  TASK_TYPES,
  TITLE_MAX_LENGTH,
  type TaskDraft,
} from '@/lib/validation/task';
import { typeLabel } from '@/lib/task-view';

/**
 * Create/edit task form (PR3 task 4.3): a client component wrapping a server
 * action with `useActionState` — validation failures re-render inline from
 * the returned state (field errors + banner) while the submitted values are
 * preserved through `defaultValue`.
 *
 * Passing `recordId` switches it into edit mode: it posts to
 * `updateTaskAction`, seeds the fields from the server-rendered record, and
 * changes the submit copy. Both action hooks are called unconditionally so
 * the hook order never depends on the mode.
 */
function FieldError({ message }: { message?: string }) {
  if (message === undefined) {
    return null;
  }
  return (
    <p role="alert" className="text-sm text-red-700">
      {message}
    </p>
  );
}

export function TaskForm({
  defaultDate = '',
  recordId,
  createdBy,
  initial,
}: {
  defaultDate?: string;
  /** Present only in edit mode — switches action, submit copy and payload. */
  recordId?: string;
  /** Owner id of the target record; advisory, Appwrite enforces the write. */
  createdBy?: string;
  /** Server-rendered record values used until the first failed submission. */
  initial?: TaskDraft;
}) {
  const editing = recordId !== undefined;

  const [createState, createAction, createPending] = useActionState<
    CreateTaskState,
    FormData
  >(createTaskAction, INITIAL_CREATE_STATE);
  const [updateState, updateAction, updatePending] = useActionState<
    UpdateTaskState,
    FormData
  >(updateTaskAction, INITIAL_UPDATE_STATE);

  const state = editing ? updateState : createState;
  const pending = editing ? updatePending : createPending;
  const formAction = editing ? updateAction : createAction;

  // Seed from the record until a submission's echoed values take over.
  const values: TaskDraft =
    Object.keys(state.values).length > 0
      ? state.values
      : editing
        ? (initial ?? {})
        : { date: defaultDate };

  return (
    <form action={formAction} className="card flex flex-col gap-4 p-5">
      {state.formError !== null ? (
        <p role="alert" className="banner banner-danger">
          {state.formError}
        </p>
      ) : null}

      {editing ? (
        <>
          <input type="hidden" name="documentId" value={recordId} />
          <input type="hidden" name="createdBy" value={createdBy ?? ''} />
        </>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="type" className="field-label">
          Tipo
        </label>
        <select
          id="type"
          name="type"
          defaultValue={values.type ?? 'task'}
          className="field"
        >
          {TASK_TYPES.map((option) => (
            <option key={option} value={option}>
              {typeLabel(option)}
            </option>
          ))}
        </select>
        <FieldError message={state.fieldErrors.type} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="field-label">
          Título
        </label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={TITLE_MAX_LENGTH}
          defaultValue={values.title}
          aria-invalid={state.fieldErrors.title !== undefined}
          className="field"
        />
        <FieldError message={state.fieldErrors.title} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="field-label">
          Descripción
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={DESCRIPTION_MAX_LENGTH}
          defaultValue={values.description}
          aria-invalid={state.fieldErrors.description !== undefined}
          className="field"
        />
        <FieldError message={state.fieldErrors.description} />
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="date" className="field-label">
            Fecha
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={values.date ?? ''}
            aria-invalid={state.fieldErrors.date !== undefined}
            className="field"
          />
          <FieldError message={state.fieldErrors.date} />
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="time" className="field-label">
            Hora
          </label>
          <input
            id="time"
            name="time"
            type="time"
            defaultValue={values.time ?? ''}
            aria-invalid={state.fieldErrors.time !== undefined}
            className="field"
          />
          <FieldError message={state.fieldErrors.time} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary disabled:opacity-60"
        >
          {pending
            ? 'Guardando…'
            : editing
              ? 'Guardar cambios'
              : 'Crear tarea'}
        </button>
        <a href="/" className="btn btn-ghost">
          Cancelar
        </a>
      </div>
    </form>
  );
}
