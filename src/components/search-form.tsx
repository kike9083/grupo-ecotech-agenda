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
    <form method="get" action="/" className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Buscar por título o descripción"
          className="field min-w-0 flex-1"
        />
        <button type="submit" className="btn btn-primary shrink-0">
          Buscar
        </button>
        {hasFilters ? (
          <a href="/" className="btn btn-secondary shrink-0">
            Limpiar
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="field-label">
            Desde
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="field"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="field-label">
            Hasta
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="field"
          />
        </div>
      </div>

      {!range.ok ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {range.error}
        </p>
      ) : null}
    </form>
  );
}
