/**
 * Keyword search box (PR3 task 4.2, spec `task-search`): a plain GET form —
 * submitting navigates to `/?q=…`, so the search runs server-side inside the
 * home RSC with no client-side state or extra dependencies.
 */
interface SearchFormProps {
  /** Current keyword (already normalized) — keeps the input in sync after submit. */
  q: string;
}

export function SearchForm({ q }: SearchFormProps) {
  return (
    <form method="get" action="/" className="flex gap-2">
      <label htmlFor="q" className="sr-only">
        Buscar
      </label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Buscar por título o descripción"
        className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium"
      >
        Buscar
      </button>
      {q !== '' ? (
        <a
          href="/"
          className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        >
          Limpiar
        </a>
      ) : null}
    </form>
  );
}
