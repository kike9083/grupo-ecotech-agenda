import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NoteForm } from '@/components/note-form';
import { getSessionSecret, getCurrentUser } from '@/lib/appwrite/session';

/**
 * Create-note route (PR4 task 4.1, spec `note-capture`): an RSC shell that
 * guards the session and renders the Tiptap note form — all mutation logic
 * lives in the `createNoteAction` server action behind it. The date is
 * optional (undated notes are stored and listed).
 */
export default async function NuevaNotaPage() {
  const user = await getCurrentUser();
  if (user === null) {
    redirect('/login?error=expired');
  }

  const secret = await getSessionSecret();
  if (secret === null) {
    redirect('/login?error=expired');
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nueva nota</h1>
        <Link
          href="/"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        >
          Volver
        </Link>
      </header>

      <p className="text-sm text-neutral-600">
        Sesión iniciada como <span className="font-medium">{user.email}</span>
      </p>

      <NoteForm />
    </main>
  );
}
