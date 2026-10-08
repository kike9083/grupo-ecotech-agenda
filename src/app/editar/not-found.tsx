import Link from 'next/link';

/** Segment 404 for `/editar` — Spanish copy per UI constraint. */
export default function EditarNotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Registro no encontrado</h1>
      <p className="text-sm text-ink-muted">
        No existe o no tienes permiso para editarlo.
      </p>
      <Link href="/" className="btn btn-primary">
        Volver al inicio
      </Link>
    </main>
  );
}
