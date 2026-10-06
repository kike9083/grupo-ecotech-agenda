/**
 * Shared loading state (PR4 task 5.3, spec `task-listing` → "UI states"):
 * the third distinct list scenario alongside the tested empty and
 * error+retry branches — shown by the co-located <Suspense> boundary around
 * the home data section (verify fix F2 replaced the root `loading.tsx`,
 * whose route-level boundary flushed status 200 before the /admin gate).
 * Presentational only; validated by `tsc`/`next build` like the other
 * components.
 */
export function LoadingState() {
  return (
    <p role="status" className="meta">
      Cargando…
    </p>
  );
}
