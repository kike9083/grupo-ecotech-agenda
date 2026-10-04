'use client';

import { useActionState } from 'react';
import { createTaskAction } from '@/actions/tasks';
import {
  INITIAL_CREATE_STATE,
  type CreateTaskState,
} from '@/lib/task-creation';
import { DESCRIPTION_MAX_LENGTH, TASK_TYPES, TITLE_MAX_LENGTH } from '@/lib/validation/task';
import { typeLabel } from '@/lib/task-view';

/**
 * Create-task form (PR3 task 4.3): a client component wrapping the
 * `createTaskAction` server action with `useActionState` — validation
 * failures re-render inline from the returned state (field errors + banner)
 * while the submitted values are preserved through `defaultValue`.
 * The route itself stays an RSC (design D3).
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

export function TaskForm({ defaultDate = '' }: { defaultDate?: string }) {
  const [state, formAction, pending] = useActionState<CreateTaskState, FormData>(
    createTaskAction,
    INITIAL_CREATE_STATE,
  );
  const values = state.values;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.formError !== null ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.formError}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="type" className="text-sm font-medium">
          Tipo
        </label>
        <select
          id="type"
          name="type"
          defaultValue={values.type ?? 'task'}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
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
        <label htmlFor="title" className="text-sm font-medium">
          Título
        </label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={TITLE_MAX_LENGTH}
          defaultValue={values.title}
          aria-invalid={state.fieldErrors.title !== undefined}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <FieldError message={state.fieldErrors.title} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium">
          Descripción
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={DESCRIPTION_MAX_LENGTH}
          defaultValue={values.description}
          aria-invalid={state.fieldErrors.description !== undefined}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <FieldError message={state.fieldErrors.description} />
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="date" className="text-sm font-medium">
            Fecha
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={values.date ?? defaultDate}
            aria-invalid={state.fieldErrors.date !== undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <FieldError message={state.fieldErrors.date} />
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="time" className="text-sm font-medium">
            Hora
          </label>
          <input
            id="time"
            name="time"
            type="time"
            defaultValue={values.time}
            aria-invalid={state.fieldErrors.time !== undefined}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <FieldError message={state.fieldErrors.time} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Guardando…' : 'Crear tarea'}
        </button>
        <a
          href="/"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          Cancelar
        </a>
      </div>
    </form>
  );
}
