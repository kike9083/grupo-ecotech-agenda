import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
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
    <PageShell
      title="Nueva tarea"
      subtitle={`Sesión iniciada como ${user.email}`}
      actions={
        <>
          <Link href="/nota" className="btn btn-secondary">
            Nueva nota
          </Link>
          <Link href="/" className="btn btn-ghost">
            Volver
          </Link>
        </>
      }
    >
      <TaskForm defaultDate={defaultDate} />
    </PageShell>
  );
}
