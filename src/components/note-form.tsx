'use client';

import { useActionState, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { createNoteAction } from '@/actions/notes';
import {
  INITIAL_NOTE_STATE,
  type CreateNoteState,
} from '@/lib/note-creation';
import { NOTE_TITLE_MAX_LENGTH } from '@/lib/validation/note';

/**
 * Create-note form (PR3 task 3.4, spec `note-capture`): a client component
 * wrapping the `createNoteAction` server action with `useActionState`. The
 * body is authored in a Tiptap editor (StarterKit) and submitted as HTML
 * through a hidden `bodyHtml` input; the title and date are optional. The
 * editor renders client-side only (`immediatelyRender: false`) so SSR and
 * hydration stay in sync.
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

export function NoteForm() {
  const [state, formAction, pending] = useActionState<CreateNoteState, FormData>(
    createNoteAction,
    INITIAL_NOTE_STATE,
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
          {pending ? 'Guardando…' : 'Guardar nota'}
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
