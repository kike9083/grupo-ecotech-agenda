import Link from 'next/link';

/** Segment 404 for `/admin` (PR4 task 5.1) — Spanish copy per UI constraint. */
export default function AdminNotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
      <p className="text-sm text-neutral-600">
        No tienes acceso a esta página o no existe.
      </p>
      <Link
        href="/"
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
