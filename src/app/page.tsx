import { redirect } from 'next/navigation';
import { logout } from '@/actions/auth';
import { getCurrentUser } from '@/lib/appwrite/session';

/**
 * Placeholder home (PR1): proves the session cookie round-trip by resolving
 * the signed-in user server-side. The real task list lands in PR3.
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user === null) {
    // Middleware guarantees a cookie here, so null means it went stale.
    // The redirect lets middleware clear it (RSCs cannot mutate cookies).
    redirect('/login?error=expired');
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Sign out
          </button>
        </form>
      </header>

      <p className="text-sm text-neutral-600">
        Signed in as <span className="font-medium">{user.email}</span>
      </p>

      <p className="text-sm text-neutral-500">
        The task list arrives in the next slice (PR3).
      </p>
    </main>
  );
}
