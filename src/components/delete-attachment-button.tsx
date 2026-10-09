'use client';

import { useActionState } from 'react';
import { deleteAttachmentAction } from '@/actions/attachments';
import { INITIAL_DELETE_ATTACHMENT_STATE } from '@/lib/attachment-flow';

/**
 * Inline delete control for one attachment (spec `attachments` → "Attachment
 * deletion"). The gallery stays a server component; this client seam exists so
 * the failure branch of `deleteAttachmentAction` has somewhere to render — the
 * action used to resolve as `void` for `unauthorized`/`unknown`, leaving the
 * tile in place with no explanation.
 */
export function DeleteAttachmentButton({ documentId }: { documentId: string }) {
  const [state, formAction, pending] = useActionState(
    deleteAttachmentAction,
    INITIAL_DELETE_ATTACHMENT_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="documentId" defaultValue={documentId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-red-700 underline disabled:opacity-60"
      >
        {pending ? 'Eliminando…' : 'Eliminar'}
      </button>
      {state.formError !== null ? (
        <p role="alert" className="max-w-[12rem] text-xs text-red-700">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}
