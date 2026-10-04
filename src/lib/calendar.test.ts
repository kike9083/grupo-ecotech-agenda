import { describe, expect, it } from 'vitest';
import {
  CALENDAR_EMPTY_MESSAGE,
  CALENDAR_LOADING_LABEL,
  CALENDAR_LOAD_ERROR_MESSAGE,
  buildCalendarHref,
  buildMonthGrid,
  daysInMonth,
  formatDayTitle,
  formatMonthKey,
  formatMonthTitle,
  gridRange,
  parseDayParam,
  parseMonthParam,
  placeRecordsByDate,
  resolveCalendarState,
  shiftMonth,
} from './calendar';

describe('daysInMonth', () => {
  it('counts the days of a 31-day and a 30-day month', () => {
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 11)).toBe(30);
  });

  it('handles February in a common and a leap year', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });
});

describe('buildMonthGrid', () => {
  it('pads the October 2026 grid with leading and trailing days', () => {
    const grid = buildMonthGrid(2026, 10);

    // 2026-10-01 is a Thursday → Monday-first grid starts on 2026-09-28.
    expect(grid).toHaveLength(35);
    expect(grid[0]).toEqual({ date: '2026-09-28', day: 28, inMonth: false });
    expect(grid[2]).toEqual({ date: '2026-09-30', day: 30, inMonth: false });
    expect(grid[3]).toEqual({ date: '2026-10-01', day: 1, inMonth: true });
    expect(grid[grid.length - 1]).toEqual({
      date: '2026-11-01',
      day: 1,
      inMonth: false,
    });
  });

  it('marks exactly the 31 October days as in-month', () => {
    const grid = buildMonthGrid(2026, 10);
    const inMonth = grid.filter((cell) => cell.inMonth);

    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].date).toBe('2026-10-01');
    expect(inMonth[30].date).toBe('2026-10-31');
  });

  it('produces a whole number of weeks and unique dates', () => {
    const grid = buildMonthGrid(2026, 2);
    const dates = new Set(grid.map((cell) => cell.date));

    expect(grid.length % 7).toBe(0);
    expect(dates.size).toBe(grid.length);
    expect(grid[6].date).toBe('2026-02-01');
  });
});

describe('gridRange', () => {
  it('returns the first and last grid days as the inclusive query bounds', () => {
    expect(gridRange(2026, 10)).toEqual({
      start: '2026-09-28',
      end: '2026-11-01',
    });
  });
});

describe('shiftMonth', () => {
  it('moves forward across a year boundary', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('moves backward across a year boundary', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('moves within the same year', () => {
    expect(shiftMonth(2026, 10, 1)).toEqual({ year: 2026, month: 11 });
    expect(shiftMonth(2026, 10, -1)).toEqual({ year: 2026, month: 9 });
  });
});

describe('formatMonthKey', () => {
  it('zero-pads the month', () => {
    expect(formatMonthKey(2026, 10)).toBe('2026-10');
    expect(formatMonthKey(2026, 1)).toBe('2026-01');
  });
});

describe('parseMonthParam', () => {
  it('parses a well-formed YYYY-MM value', () => {
    expect(parseMonthParam('2026-10')).toEqual({ year: 2026, month: 10 });
  });

  it('falls back to the supplied current month when missing or invalid', () => {
    const now = new Date('2026-03-15T12:00:00.000Z');
    expect(parseMonthParam(undefined, now)).toEqual({ year: 2026, month: 3 });
    expect(parseMonthParam('2026-13', now)).toEqual({ year: 2026, month: 3 });
    expect(parseMonthParam('bogus', now)).toEqual({ year: 2026, month: 3 });
  });
});

describe('parseDayParam', () => {
  it('accepts a real calendar date', () => {
    expect(parseDayParam('2026-10-15')).toBe('2026-10-15');
  });

  it('rejects an impossible date or a malformed value', () => {
    expect(parseDayParam('2026-02-30')).toBeUndefined();
    expect(parseDayParam('15/10/2026')).toBeUndefined();
    expect(parseDayParam(undefined)).toBeUndefined();
  });
});

describe('formatMonthTitle', () => {
  it('renders the Spanish month and year', () => {
    expect(formatMonthTitle(2026, 10)).toBe('octubre de 2026');
    expect(formatMonthTitle(2026, 1)).toBe('enero de 2026');
  });
});

describe('formatDayTitle', () => {
  it('renders a long Spanish day label', () => {
    expect(formatDayTitle('2026-10-15')).toBe('15 de octubre de 2026');
  });

  it('returns the raw value when it is not an ISO date', () => {
    expect(formatDayTitle('ayer')).toBe('ayer');
  });
});

describe('placeRecordsByDate', () => {
  it('groups records by their date and drops undated records', () => {
    const records = [
      { $id: 'a', date: '2026-10-15' },
      { $id: 'b', date: '2026-10-15' },
      { $id: 'c', date: '2026-10-16' },
      { $id: 'note', date: '' },
    ];

    const byDate = placeRecordsByDate(records);

    expect(Object.keys(byDate)).toEqual(['2026-10-15', '2026-10-16']);
    expect(byDate['2026-10-15'].map((record) => record.$id)).toEqual(['a', 'b']);
    expect(byDate['2026-10-16'].map((record) => record.$id)).toEqual(['c']);
    expect(byDate['']).toBeUndefined();
  });

  it('returns an empty map when every record is undated', () => {
    expect(placeRecordsByDate([{ date: '' }, { date: '' }])).toEqual({});
  });
});

describe('buildCalendarHref', () => {
  it('falls back to the bare calendar route', () => {
    expect(buildCalendarHref({})).toBe('/calendario');
    expect(buildCalendarHref({ month: '', day: '' })).toBe('/calendario');
  });

  it('carries the month and day', () => {
    expect(buildCalendarHref({ month: '2026-10' })).toBe(
      '/calendario?month=2026-10',
    );
    expect(buildCalendarHref({ month: '2026-10', day: '2026-10-15' })).toBe(
      '/calendario?month=2026-10&day=2026-10-15',
    );
  });
});

describe('resolveCalendarState', () => {
  it('classifies the three calendar states', () => {
    expect(resolveCalendarState(null)).toBe('error');
    expect(resolveCalendarState(0)).toBe('empty');
    expect(resolveCalendarState(3)).toBe('results');
  });
});

describe('calendar UI copy', () => {
  it('provides distinct Spanish copy for the empty, loading and error states', () => {
    expect(CALENDAR_EMPTY_MESSAGE).toBe(
      'No hay registros con fecha en este mes.',
    );
    expect(CALENDAR_LOADING_LABEL).toBe('Cargando calendario…');
    expect(CALENDAR_LOAD_ERROR_MESSAGE).toBe(
      'No se pudo cargar el calendario. Intenta de nuevo más tarde.',
    );
    expect(new Set([CALENDAR_EMPTY_MESSAGE, CALENDAR_LOADING_LABEL, CALENDAR_LOAD_ERROR_MESSAGE]).size).toBe(3);
  });
});
