import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TaskForm } from '@/components/task-form';
import { getSessionSecret, getCurrentUser } from '@/lib/appwrite/session';

/**
 * Create route (PR3 task 4.3, design D3): an RSC shell that guards the
 * session and renders the form — all mutation logic lives in the
 * `createTaskAction` server action behind it.
 */
export default async function NuevaTareaPage() {
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
        <h1 className="text-2xl font-semibold">Nueva tarea</h1>
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

      <TaskForm />
    </main>
  );
}
