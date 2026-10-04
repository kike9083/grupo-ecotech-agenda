/**
 * Calendar view helpers (PR8, spec `calendar-view`, design D4).
 *
 * Hand-rolled, dependency-free month-grid math plus the URL-driven navigation
 * helpers. Pure functions only, so every branch the RSC renders is decided
 * here and unit-tested in the node environment. Dates are plain `YYYY-MM-DD`
 * strings (no timezone) exactly like the stored `date` attribute.
 */

import { isRealCalendarDate } from '@/lib/validation/task';

/** Monday-first weekday header (Spanish, matching the app's copy). */
export const WEEKDAY_LABELS = [
  'Lun',
  'Mar',
  'Mié',
  'Jue',
  'Vie',
  'Sáb',
  'Dom',
] as const;

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** One cell of the rendered month grid. */
export interface CalendarDay {
  /** ISO date (`YYYY-MM-DD`) this cell links to. */
  date: string;
  /** Day of month (1..31). */
  day: number;
  /** True when the cell belongs to the displayed month. */
  inMonth: boolean;
}

export interface CalendarMonth {
  year: number;
  month: number;
}

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` from numeric parts (no `Date`/timezone involved). */
export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Real number of days in a month — leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Builds the full grid for a month: whole weeks (Monday-first), padded with
 * the trailing days of the previous month and the leading days of the next,
 * exactly like a paper calendar. `month` is 1-based.
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // 0 = Monday
  const start = new Date(Date.UTC(year, month - 1, 1 - offset));
  const used = offset + daysInMonth(year, month);
  const trailing = (7 - (used % 7)) % 7;
  const count = used + trailing;

  const grid: CalendarDay[] = [];
  for (let index = 0; index < count; index += 1) {
    const cell = new Date(start.getTime());
    cell.setUTCDate(start.getUTCDate() + index);
    grid.push({
      date: toIsoDate(
        cell.getUTCFullYear(),
        cell.getUTCMonth() + 1,
        cell.getUTCDate(),
      ),
      day: cell.getUTCDate(),
      inMonth:
        cell.getUTCMonth() === month - 1 && cell.getUTCFullYear() === year,
    });
  }
  return grid;
}

/**
 * Inclusive bounds of the visible grid — the exact arguments for the
 * `Query.between('date', start, end)` calendar query (design D4).
 */
export function gridRange(
  year: number,
  month: number,
): { start: string; end: string } {
  const grid = buildMonthGrid(year, month);
  const first = grid[0];
  const last = grid[grid.length - 1];
  return { start: first.date, end: last.date };
}

/** Month arithmetic across year boundaries (`delta` in months). */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): CalendarMonth {
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (((index % 12) + 12) % 12) + 1;
  return { year: nextYear, month: nextMonth };
}

/** `YYYY-MM` key used by the `?month=` URL parameter. */
export function formatMonthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/**
 * Parses `?month=YYYY-MM`; a missing or invalid value falls back to the
 * supplied "current" instant so the calendar always renders a month.
 */
export function parseMonthParam(
  value: string | undefined,
  now: Date = new Date(),
): CalendarMonth {
  const raw = (value ?? '').trim();
  const match = MONTH_PATTERN.exec(raw);
  if (match !== null) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12 && year >= 1900 && year <= 2999) {
      return { year, month };
    }
  }
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

/** Parses `?day=YYYY-MM-DD`; anything that is not a real date is dropped. */
export function parseDayParam(value: string | undefined): string | undefined {
  const raw = (value ?? '').trim();
  return isRealCalendarDate(raw) ? raw : undefined;
}

/** Displayed month heading: "octubre de 2026". */
export function formatMonthTitle(year: number, month: number): string {
  const name = MONTH_NAMES_ES[month - 1] ?? String(month);
  return `${name} de ${year}`;
}

/** Long Spanish day label: "15 de octubre de 2026". */
export function formatDayTitle(date: string): string {
  const match = ISO_DATE_PATTERN.exec(date);
  if (match === null) {
    return date;
  }
  const [, year, month, day] = match;
  const name = MONTH_NAMES_ES[Number(month) - 1] ?? month;
  return `${Number(day)} de ${name} de ${year}`;
}

/**
 * Groups records by their `date` so each day cell can render its own rows.
 * Undated records (`date === ''`) are excluded from the grid — they stay
 * reachable from the list (spec `calendar-view` → "Undated note excluded").
 */
export function placeRecordsByDate<T extends { date: string }>(
  records: readonly T[],
): Record<string, T[]> {
  const byDate: Record<string, T[]> = {};
  for (const record of records) {
    if (record.date === '') {
      continue;
    }
    (byDate[record.date] ??= []).push(record);
  }
  return byDate;
}

/** Builds a `/calendario` URL from the current month/day selection. */
export function buildCalendarHref(params: {
  month?: string;
  day?: string;
}): string {
  const query = new URLSearchParams();
  if (params.month !== undefined && params.month !== '') {
    query.set('month', params.month);
  }
  if (params.day !== undefined && params.day !== '') {
    query.set('day', params.day);
  }
  const serialized = query.toString();
  return serialized === '' ? '/calendario' : `/calendario?${serialized}`;
}

export const CALENDAR_EMPTY_MESSAGE =
  'No hay registros con fecha en este mes.';
export const CALENDAR_LOADING_LABEL = 'Cargando calendario…';
export const CALENDAR_LOAD_ERROR_MESSAGE =
  'No se pudo cargar el calendario. Intenta de nuevo más tarde.';
export const CALENDAR_RETRY_LABEL = 'Reintentar';
export const CALENDAR_TODAY_LABEL = 'Hoy';
export const CALENDAR_PREV_LABEL = 'Mes anterior';
export const CALENDAR_NEXT_LABEL = 'Mes siguiente';
export const CALENDAR_CREATE_LABEL = 'Nueva tarea para este día';
export const CALENDAR_BACK_LABEL = 'Volver a la lista';

export type CalendarStateKind = 'error' | 'empty' | 'results';

/**
 * Classifies the calendar data region: `null` means the load failed, `0` means
 * the month has no dated records, anything else renders the grid.
 */
export function resolveCalendarState(
  datedCount: number | null,
): CalendarStateKind {
  if (datedCount === null) {
    return 'error';
  }
  return datedCount === 0 ? 'empty' : 'results';
}
