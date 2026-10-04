import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TaskForm } from '@/components/task-form';
import { getSessionSecret, getCurrentUser } from '@/lib/appwrite/session';
import { parseDayParam } from '@/lib/calendar';
import type { RawSearchParams } from '@/lib/search-query';

/**
 * Create route (PR3 task 4.3, design D3): an RSC shell that guards the
 * session and renders the form — all mutation logic lives in the
 * `createTaskAction` server action behind it. `?date=YYYY-MM-DD` (the
 * calendar's create-from-day entry point, spec `calendar-view` → "Day
 * selection") pre-fills the date field.
 */
export default async function NuevaTareaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getCurrentUser();
  if (user === null) {
    redirect('/login?error=expired');
  }

  const secret = await getSessionSecret();
  if (secret === null) {
    redirect('/login?error=expired');
  }

  const params = await searchParams;
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const defaultDate = parseDayParam(rawDate) ?? '';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nueva tarea</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/nota"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Nueva nota
          </Link>
          <Link
            href="/"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Volver
          </Link>
        </div>
      </header>

      <p className="text-sm text-neutral-600">
        Sesión iniciada como <span className="font-medium">{user.email}</span>
      </p>

      <TaskForm defaultDate={defaultDate} />
    </main>
  );
}
