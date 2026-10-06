import Link from 'next/link';

/** Segment 404 for `/admin` (PR4 task 5.1) — Spanish copy per UI constraint. */
export default function AdminNotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
      <p className="text-sm text-ink-muted">
        No tienes acceso a esta página o no existe.
      </p>
      <Link
        href="/"
        className="btn btn-primary"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
