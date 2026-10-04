/**
 * Shared loading state (PR4 task 5.3, spec `task-listing` → "UI states"):
 * the third distinct list scenario alongside the tested empty and
 * error+retry branches — shown by the route-level `loading.tsx` files
 * while a server component stream resolves. Presentational only; validated
 * by `tsc`/`next build` like the other components.
 */
export function LoadingState() {
  return (
    <p role="status" className="text-sm text-neutral-500">
      Cargando…
    </p>
  );
}
