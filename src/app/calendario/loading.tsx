import { CALENDAR_LOADING_LABEL } from '@/lib/calendar';

/**
 * Route-level loading state for `/calendario` (PR8 task 8.6, spec
 * `calendar-view` → "Calendar UI states"). Distinct from the empty and error
 * copies; the route is session-guarded so a 200 flush here is safe (unlike the
 * root route's admin gate — verify fix F2).
 *
 * The skeleton mirrors `PageShell` + `MonthGrid` geometry so the streamed
 * answer does not shift the layout when it lands.
 */
export default function CalendarioLoading() {
  return (
    <div className="min-h-screen">
      <header className="frosted">
        <div className="page-shell flex min-h-16 flex-wrap items-center gap-3 py-3">
          <span
            aria-hidden="true"
            className="size-9 rounded-xl bg-surface-sunken"
          />
          <div className="flex flex-col gap-1.5">
            <span
              aria-hidden="true"
              className="block h-4 w-28 rounded bg-surface-sunken"
            />
            <span
              aria-hidden="true"
              className="block h-3 w-40 rounded bg-surface-sunken"
            />
          </div>
        </div>
      </header>

      <main className="page-shell flex flex-col gap-4 py-8">
        <section className="card p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span
              aria-hidden="true"
              className="h-9 w-24 rounded-lg bg-surface-sunken"
            />
            <span
              aria-hidden="true"
              className="h-6 w-40 rounded bg-surface-sunken"
            />
            <span
              aria-hidden="true"
              className="h-9 w-24 rounded-lg bg-surface-sunken"
            />
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1" aria-hidden="true">
            {Array.from({ length: 35 }, (_, index) => (
              <span key={index} className="min-h-24 rounded-lg border border-hairline" />
            ))}
          </div>
        </section>

        <p role="status" className="meta">
          {CALENDAR_LOADING_LABEL}
        </p>
      </main>
    </div>
  );
}
