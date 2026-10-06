'use client';

import { useActionState } from 'react';
import { updateStatusAction } from '@/actions/tasks';
import { INITIAL_STATUS_UPDATE_STATE } from '@/lib/task-status';
import type { TaskStatus } from '@/lib/validation/task';
import { allowedTransitions, statusActionLabel } from '@/lib/task-view';

/**
 * Transition buttons for one row (PR4 task 5.2, spec `task-registration` →
 * "Status lifecycle" + `record-visibility` → "Owner write"): the offered
 * moves come from the same `allowedTransitions`/`canTransition` matrix the
 * action enforces, so the UI can never present an illegal choice. Hidden
 * fields are advisory — Appwrite document permissions are the backstop and
 * the action re-checks owner/admin before any write.
 */
interface StatusControlsProps {
  task: {
    $id: string;
    status: TaskStatus;
    createdBy: string;
  };
}

export function StatusControls({ task }: StatusControlsProps) {
  const [state, formAction, pending] = useActionState(
    updateStatusAction,
    INITIAL_STATUS_UPDATE_STATE,
  );

  const options = allowedTransitions(task.status);
  if (options.length === 0) {
    return null;
  }

  return (
    <form
      action={formAction}
      className="flex w-full flex-wrap items-center gap-2"
    >
      <input type="hidden" name="documentId" defaultValue={task.$id} />
      <input type="hidden" name="createdBy" defaultValue={task.createdBy} />
      <input type="hidden" name="from" defaultValue={task.status} />
      {options.map((to) => (
        <button
          key={to}
          type="submit"
          name="to"
          value={to}
          disabled={pending}
          className="btn btn-secondary btn-sm disabled:opacity-60"
        >
          {statusActionLabel(to)}
        </button>
      ))}
      {state.message !== null ? (
        <p role="alert" className="w-full text-xs text-red-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
