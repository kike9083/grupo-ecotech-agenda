import Link from 'next/link';
import type { Task } from '@/lib/appwrite/tasks';
import {
  resolveCalendarState,
  buildCalendarHref,
  CALENDAR_EMPTY_MESSAGE,
  CALENDAR_LOAD_ERROR_MESSAGE,
  CALENDAR_NEXT_LABEL,
  CALENDAR_PREV_LABEL,
  CALENDAR_RETRY_LABEL,
  formatMonthTitle,
  shiftMonth,
  type CalendarDay,
} from '@/lib/calendar';
import { DayCell, DayDetail } from '@/components/day-cell';
import { WEEKDAY_LABELS } from '@/lib/calendar';

/**
 * Month grid (PR8 task 8.4, spec `calendar-view`): the whole month as GET
 * links — month navigation, day selection and day detail — with no client
 * state (design D4). Every decision comes from the tested `calendar.ts`
 * helpers; this component is validated by `tsc`/`next build`.
 */
interface MonthGridProps {
  year: number;
  month: number;
  grid: CalendarDay[];
  /** Records placed by date for the visible grid. */
  recordsByDate: Record<string, Task[]>;
  /** Selected day (`YYYY-MM-DD`) or undefined when none is selected. */
  selectedDay?: string;
  /** `null` when the load failed, an empty grid otherwise. */
  loadFailed: boolean;
  errorMessage?: string;
}

export function MonthGrid({
  year,
  month,
  grid,
  recordsByDate,
  selectedDay,
  loadFailed,
  errorMessage,
}: MonthGridProps) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const previous = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const datedCount = Object.values(recordsByDate).reduce(
    (total, records) => total + records.length,
    0,
  );

  if (loadFailed) {
    return (
      <section
        role="alert"
        className="banner banner-danger flex flex-col items-start gap-2"
      >
        <p className="text-sm text-red-700">
          {errorMessage ?? CALENDAR_LOAD_ERROR_MESSAGE}
        </p>
        <Link
          href={buildCalendarHref({ month: monthKey })}
          className="text-sm font-medium text-red-800 underline"
        >
          {CALENDAR_RETRY_LABEL}
        </Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link
          href={buildCalendarHref({
            month: `${previous.year}-${String(previous.month).padStart(2, '0')}`,
          })}
          className="btn btn-secondary"
        >
          {CALENDAR_PREV_LABEL}
        </Link>
        <h2 className="text-lg font-semibold">{formatMonthTitle(year, month)}</h2>
        <Link
          href={buildCalendarHref({
            month: `${next.year}-${String(next.month).padStart(2, '0')}`,
          })}
          className="btn btn-secondary"
        >
          {CALENDAR_NEXT_LABEL}
        </Link>
      </div>

      {resolveCalendarState(datedCount) === 'empty' ? (
        <p className="meta">{CALENDAR_EMPTY_MESSAGE}</p>
      ) : null}

      <div className="grid grid-cols-7 gap-1 text-center meta font-medium">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell) => (
          <DayCell
            key={cell.date}
            date={cell.date}
            day={cell.day}
            inMonth={cell.inMonth}
            records={recordsByDate[cell.date] ?? []}
            selected={selectedDay === cell.date}
            monthKey={monthKey}
          />
        ))}
      </div>

      {selectedDay !== undefined ? (
        <DayDetail
          date={selectedDay}
          records={recordsByDate[selectedDay] ?? []}
        />
      ) : null}
    </div>
  );
}
