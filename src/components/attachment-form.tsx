'use client';

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ATTACHMENT_ACCEPT } from '@/lib/attachments';

/**
 * Upload form for one record (PR6 task 6.6, spec `attachments` → "Attachment
 * upload" / "Upload failure handling"): posts the file to the route handler
 * (NOT a server action — Next caps action bodies at 1 MB), surfaces the
 * server's inline Spanish error and lets the user retry in place. On success
 * it clears the input and refreshes the server-rendered gallery.
 */
export function AttachmentForm({ recordId }: { recordId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (file === undefined) {
      // Judge finding: a bare `return` here made "Adjuntar" look dead — the
      // server's 400 is unreachable from this path, so the form must say why
      // nothing happened instead of staying silent.
      setSuccess(false);
      setError('Selecciona un archivo antes de adjuntar.');
      return;
    }

    const body = new FormData();
    body.set('recordId', recordId);
    body.set('file', file);

    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const response = await fetch('/api/attachments/upload', {
        method: 'POST',
        body,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? 'No se pudo subir el archivo. Intenta de nuevo.');
        return;
      }
      if (inputRef.current !== null) {
        inputRef.current.value = '';
      }
      // Explicit confirmation: without it a silent refresh reads as "nothing
      // happened" and the user assumes the attachment was lost.
      setSuccess(true);
      router.refresh();
    } catch {
      setError('No se pudo subir el archivo. Intenta de nuevo.');
    } finally {
      setPending(false);
    }
  }

  /** Picking a file clears the previous reason so the stale banner never lingers. */
  function handleFileChange(_event: ChangeEvent<HTMLInputElement>): void {
    setError(null);
    setSuccess(false);
  }

  const inputId = `attachment-${recordId}`;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-xs font-medium">
        Adjuntar archivo
      </label>
      <input
        ref={inputRef}
        id={inputId}
        name="file"
        type="file"
        accept={ATTACHMENT_ACCEPT}
        onChange={handleFileChange}
        className="text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="btn btn-secondary btn-sm disabled:opacity-60"
      >
        {pending ? 'Subiendo…' : 'Adjuntar'}
      </button>
      {error !== null ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-xs text-accent-ink">
          Archivo adjuntado correctamente.
        </p>
      ) : null}
    </form>
  );
}
