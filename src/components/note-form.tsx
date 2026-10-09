'use client';

import { useActionState, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { createNoteAction, updateNoteAction } from '@/actions/notes';
import {
  INITIAL_NOTE_STATE,
  type CreateNoteState,
} from '@/lib/note-creation';
import { NOTE_TITLE_MAX_LENGTH } from '@/lib/validation/note';

/**
 * Note form (PR3 task 3.4, spec `note-capture`): a client component wrapping
 * the note server actions with `useActionState`. Without `recordId` it
 * creates through `createNoteAction`; with it, it edits through
 * `updateNoteAction` — notes previously had no edit affordance anywhere, so
 * the calendar's Editar link dead-ended in `TaskForm`, which requires a time
 * a note never stores. The body is authored in a Tiptap editor (StarterKit)
 * and submitted as HTML through a hidden `bodyHtml` input; the title and date
 * are optional. The editor renders client-side only (`immediatelyRender:
 * false`) so SSR and hydration stay in sync.
 */
interface NoteFormProps {
  /** Present → edit this note instead of creating a new one. */
  recordId?: string;
  /** Owner id, advisory — the action re-checks it against the session. */
  createdBy?: string;
  /** Server-rendered current values for edit mode. */
  initial?: { title: string; date: string; bodyHtml: string };
}

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

export function NoteForm({ recordId, createdBy, initial }: NoteFormProps = {}) {
  // Both actions share the same state shape, so the hook never changes shape
  // between modes — only which action it dispatches to.
  const action = recordId === undefined ? createNoteAction : updateNoteAction;
  const [state, formAction, pending] = useActionState<CreateNoteState, FormData>(
    action,
    recordId === undefined
      ? INITIAL_NOTE_STATE
      : { fieldErrors: {}, formError: null, values: initial ?? {} },
  );
  const values = state.values;
  const [bodyHtml, setBodyHtml] = useState(values.bodyHtml ?? '');

  const editor = useEditor({
    extensions: [StarterKit],
    content: values.bodyHtml ?? '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'field min-h-32 focus:outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
      },
    },
    onUpdate: ({ editor: instance }) => {
      setBodyHtml(instance.getHTML());
    },
  });

  return (
    <form action={formAction} className="card flex flex-col gap-4 p-5">
      {recordId !== undefined ? (
        <>
          <input type="hidden" name="documentId" defaultValue={recordId} />
          <input type="hidden" name="createdBy" defaultValue={createdBy ?? ''} />
        </>
      ) : null}
      {state.formError !== null ? (
        <p role="alert" className="banner banner-danger">
          {state.formError}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="field-label">
          Título (opcional)
        </label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={NOTE_TITLE_MAX_LENGTH}
          defaultValue={values.title}
          aria-invalid={state.fieldErrors.title !== undefined}
          className="field"
        />
        <FieldError message={state.fieldErrors.title} />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Contenido</span>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            disabled={editor === null}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className="btn btn-secondary btn-sm disabled:opacity-50"
          >
            Negrita
          </button>
          <button
            type="button"
            disabled={editor === null}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className="btn btn-secondary btn-sm disabled:opacity-50"
          >
            Cursiva
          </button>
          <button
            type="button"
            disabled={editor === null}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
            className="btn btn-secondary btn-sm disabled:opacity-50"
          >
            Título
          </button>
          <button
            type="button"
            disabled={editor === null}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className="btn btn-secondary btn-sm disabled:opacity-50"
          >
            Lista
          </button>
        </div>
        <EditorContent editor={editor} />
        <input type="hidden" name="bodyHtml" value={bodyHtml} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="date" className="field-label">
          Fecha (opcional)
        </label>
        <input
          id="date"
          name="date"
          type="date"
          defaultValue={values.date}
          aria-invalid={state.fieldErrors.date !== undefined}
          className="field"
        />
        <FieldError message={state.fieldErrors.date} />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary disabled:opacity-60"
        >
          {pending
            ? 'Guardando…'
            : recordId === undefined
              ? 'Guardar nota'
              : 'Guardar cambios'}
        </button>
        <a
          href="/"
          className="btn btn-ghost"
        >
          Cancelar
        </a>
      </div>
    </form>
  );
}
