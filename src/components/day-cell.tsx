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
        'flex min-h-24 flex-col gap-1 rounded-md border p-2',
        inMonth ? 'border-neutral-300' : 'border-neutral-200 bg-neutral-50',
        selected ? 'ring-2 ring-neutral-900' : '',
      ]
        .filter((className) => className !== '')
        .join(' ')}
    >
      <div className="flex items-center justify-between">
        <Link
          href={buildCalendarHref({ month: monthKey, day: date })}
          className={[
            'rounded-full px-2 text-xs font-medium',
            selected ? 'bg-neutral-900 text-white' : 'text-neutral-600',
            inMonth ? '' : 'text-neutral-400',
          ]
            .filter((className) => className !== '')
            .join(' ')}
        >
          {day}
        </Link>
        {hasRecords ? (
          <span className="text-xs text-neutral-500">{records.length}</span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1">
        {records.map((record) => (
          <li
            key={record.$id}
            className="truncate rounded bg-neutral-100 px-1 text-xs"
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
      className="flex flex-col gap-2 rounded-md border border-neutral-300 px-3 py-2"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{formatDayTitle(date)}</h2>
        <Link
          href={`/nueva?date=${date}`}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        >
          Nueva tarea para este día
        </Link>
      </div>

      {records.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No hay registros para este día.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {records.map((record) => (
            <li key={record.$id} className="flex items-center gap-2 text-sm">
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800">
                {typeLabel(record.type)}
              </span>
              <span className="font-mono text-xs text-neutral-600">
                {record.time}
              </span>
              <span className="min-w-0 truncate">
                {record.title !== '' ? record.title : 'Sin título'}
              </span>
              <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs font-medium">
                {statusLabel(record.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
