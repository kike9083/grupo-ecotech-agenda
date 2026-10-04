import { CALENDAR_LOADING_LABEL } from '@/lib/calendar';

/**
 * Route-level loading state for `/calendario` (PR8 task 8.6, spec
 * `calendar-view` → "Calendar UI states"). Distinct from the empty and error
 * copies; the route is session-guarded so a 200 flush here is safe (unlike the
 * root route's admin gate — verify fix F2).
 */
export default function CalendarioLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <p role="status" className="text-sm text-neutral-500">
        {CALENDAR_LOADING_LABEL}
      </p>
    </main>
  );
}
