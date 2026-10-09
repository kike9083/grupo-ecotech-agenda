'use client';

import { useActionState, useState } from 'react';
import { deleteTaskAction } from '@/actions/tasks';
import { INITIAL_DELETE_STATE } from '@/lib/task-delete';

/**
 * Two-step destructive button (spec → record removal): the first click only
 * arms the confirm, so a stray tap on a list row can never delete anything.
 * Submitting runs the tested `deleteTaskAction`; a failure comes back as an
 * inline banner and the confirm stays armed so the retry needs one click.
 * Hidden fields are advisory — Appwrite permissions are the backstop and the
 * action re-checks owner/admin before touching data.
 */
interface DeleteTaskButtonProps {
  task: {
    $id: string;
    createdBy: string;
  };
  /** Extra classes so each placement can size and align itself. */
  className?: string;
}

export function DeleteTaskButton({ task, className = '' }: DeleteTaskButtonProps) {
  const [armed, setArmed] = useState(false);
  const [state, formAction, pending] = useActionState(
    deleteTaskAction,
    INITIAL_DELETE_STATE,
  );

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        disabled={pending}
        className={`btn btn-danger-ghost btn-sm ${className}`}
      >
        Eliminar
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className={`flex flex-wrap items-center gap-2 ${className}`}
    >
      <input type="hidden" name="documentId" defaultValue={task.$id} />
      <input type="hidden" name="createdBy" defaultValue={task.createdBy} />
      <button
        type="submit"
        disabled={pending}
        className="btn btn-danger btn-sm disabled:opacity-60"
      >
        {pending ? 'Eliminando…' : 'Confirmar eliminación'}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={pending}
        className="btn btn-ghost btn-sm"
      >
        Cancelar
      </button>
      {state.formError !== null ? (
        <p role="alert" className="w-full text-xs text-red-700">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}
