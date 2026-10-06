import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared chrome for every sub-route (Nueva, Nota, Calendario, Telegram,
 * Admin): a frosted sticky bar with the brand mark linking back to the home
 * list plus an action cluster, over a `page-shell` content column. It exists
 * so the five headers cannot drift from the home header's design tokens.
 */
export function PageShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="frosted">
        <div className="page-shell flex min-h-16 flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2.5">
            <Link
              href="/"
              aria-label="Volver a la agenda"
              className="flex size-9 items-center justify-center rounded-xl bg-accent-soft transition hover:bg-accent/15"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-5 text-accent"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
              </svg>
            </Link>
            <div className="flex flex-col leading-tight">
              <h1 className="text-base font-bold">{title}</h1>
              <span className="meta">{subtitle ?? 'Grupo Ecotech'}</span>
            </div>
          </div>

          {actions ? (
            <nav className="flex flex-wrap items-center justify-end gap-2">
              {actions}
            </nav>
          ) : null}
        </div>
      </header>

      <main className="page-shell flex flex-col gap-6 py-8">{children}</main>
    </div>
  );
}
