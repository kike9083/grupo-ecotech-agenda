import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NoteForm } from '@/components/note-form';
import { PageShell } from '@/components/page-shell';
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
    <PageShell
      title="Nueva nota"
      subtitle={`Sesión iniciada como ${user.email}`}
      actions={
        <Link href="/" className="btn btn-ghost">
          Volver
        </Link>
      }
    >
      <NoteForm />
    </PageShell>
  );
}
