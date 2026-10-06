import Link from 'next/link';
import type { Task } from '@/lib/appwrite/tasks';
import { buildCalendarHref, formatDayTitle } from '@/lib/calendar';
import { statusLabel, typeLabel } from '@/lib/task-view';

/**
 * Day cell of the month grid (PR8 task 8.4, spec `calendar-view` → "Day
 * selection"). Presentational: the whole cell is a GET link that selects the
 * day, and the selected day shows a create entry point pointing at
 * `/nueva?date=…`. Validated by `tsc`/`next build` like the other components.
 */
interface DayCellProps {
  date: string;
  day: number;
  inMonth: boolean;
  records: Task[];
  selected: boolean;
  /** Canonical `YYYY-MM` of the displayed month — carried in every link. */
  monthKey: string;
}

export function DayCell({
  date,
  day,
  inMonth,
  records,
  selected,
  monthKey,
}: DayCellProps) {
  const hasRecords = records.length > 0;

  return (
    <div
      className={[
        'flex min-h-24 flex-col gap-1 rounded-lg border p-2',
        inMonth ? 'border-hairline' : 'border-hairline bg-surface-sunken',
        selected ? 'ring-2 ring-accent' : '',
      ]
        .filter((className) => className !== '')
        .join(' ')}
    >
      <div className="flex items-center justify-between">
        <Link
          href={buildCalendarHref({ month: monthKey, day: date })}
          className={[
            'rounded-full px-2 text-xs font-medium',
            selected ? 'bg-accent text-white' : 'text-ink-muted',
            inMonth ? '' : 'text-ink-subtle',
          ]
            .filter((className) => className !== '')
            .join(' ')}
        >
          {day}
        </Link>
        {hasRecords ? (
          <span className="meta">{records.length}</span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1">
        {records.map((record) => (
          <li
            key={record.$id}
            className="truncate rounded bg-surface-sunken px-1 text-xs"
          >
            <span className="font-medium">{typeLabel(record.type)}</span>
            <span className="ml-1">
              {record.title !== '' ? record.title : statusLabel(record.status)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Detail panel for the selected day (spec `calendar-view` → "Day detail"):
 * that day's records plus the create entry point pre-filled with the date.
 */
export function DayDetail({
  date,
  records,
}: {
  date: string;
  records: Task[];
}) {
  return (
    <section
      aria-label="Detalle del día"
      className="card flex flex-col gap-2 p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{formatDayTitle(date)}</h2>
        <Link
          href={`/nueva?date=${date}`}
          className="btn btn-secondary"
        >
          Nueva tarea para este día
        </Link>
      </div>

      {records.length === 0 ? (
        <p className="meta">
          No hay registros para este día.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {records.map((record) => (
            <li key={record.$id} className="flex items-center gap-2 text-sm">
              <span className="badge badge-accent">
                {typeLabel(record.type)}
              </span>
              <span className="font-mono meta">
                {record.time}
              </span>
              <span className="min-w-0 truncate">
                {record.title !== '' ? record.title : 'Sin título'}
              </span>
              <span className="badge badge-neutral">
                {statusLabel(record.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
