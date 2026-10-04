import { validateDateRange } from '@/lib/search-query';

/**
 * Keyword + optional date-range search box (PR3 task 4.2, PR9 tasks 9.2/9.5,
 * spec `task-search`): a plain GET form — submitting navigates to
 * `/?q=&from=&to=`, so the search runs server-side inside the home RSC with
 * no client-side state or extra dependencies. An invalid range (malformed or
 * `from > to`) renders the Spanish inline error and no query runs.
 */
interface SearchFormProps {
  /** Current keyword (already normalized) — keeps the input in sync after submit. */
  q: string;
  /** Inclusive lower date bound (`YYYY-MM-DD`); empty when unset. */
  from?: string;
  /** Inclusive upper date bound (`YYYY-MM-DD`); empty when unset. */
  to?: string;
}

export function SearchForm({ q, from = '', to = '' }: SearchFormProps) {
  const range = validateDateRange(from, to);
  const hasFilters = q !== '' || from !== '' || to !== '';

  return (
    <form method="get" action="/" className="flex flex-col gap-2">
      <div className="flex gap-2">
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
        {hasFilters ? (
          <a
            href="/"
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Limpiar
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs font-medium text-neutral-600">
            Desde
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs font-medium text-neutral-600">
            Hasta
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {!range.ok ? (
        <p role="alert" className="text-sm text-red-700">
          {range.error}
        </p>
      ) : null}
    </form>
  );
}
