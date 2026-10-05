import { describe, expect, it } from 'vitest';
import { isEligible, panamaWallClock, windowStart } from './reminders';

/**
 * PR6 task 6.3 (design D2 — Panama wall-clock string compare) — the pure
 * decide half of the scheduler: zero I/O, a fixed `nowWall` string, no clock,
 * no provider.
 *
 * Specs: `reminder-delivery` → Eligibility (Due record fires, Missing date or
 * time never notifies, Terminal status skipped, Outside late window skipped)
 * plus Notified marking's `notified !== true` filter and Creator-only's
 * linked-creator gate. `notification-channels` → "Scheduler depends only on
 * the interface" is enforced separately by the source scan (task 6.9).
 *
 * All datetimes are Panama wall-clock strings (`YYYY-MM-DDTHH:mm`), so
 * lexicographic comparison IS chronological (design D2).
 */

const NOW = '2026-10-04T10:00';
const LINKED = new Set(['user-a']);

function candidate(overrides: Partial<Parameters<typeof isEligible>[0]> = {}) {
  return {
    $id: 'record-1',
    type: 'task',
    date: '2026-10-04',
    time: '09:00',
    status: 'open',
    createdBy: 'user-a',
    notified: null,
    ...overrides,
  };
}

describe('isEligible (spec reminder-delivery → Eligibility)', () => {
  it('fires for an open record whose scheduled moment has passed today', () => {
    expect(isEligible(candidate(), NOW, LINKED)).toBe(true);
  });

  it('never notifies a record with a date but no time', () => {
    expect(isEligible(candidate({ time: '' }), NOW, LINKED)).toBe(false);
  });

  it('never notifies an undated record', () => {
    expect(isEligible(candidate({ date: '' }), NOW, LINKED)).toBe(false);
  });

  it('skips a terminal status', () => {
    expect(isEligible(candidate({ status: 'done' }), NOW, LINKED)).toBe(false);
    expect(isEligible(candidate({ status: 'cancelled' }), NOW, LINKED)).toBe(
      false,
    );
  });

  it('skips a record outside the 24 h late window', () => {
    // Scheduled 2026-10-03T09:00 — more than 24 h before NOW.
    expect(
      isEligible(candidate({ date: '2026-10-03', time: '09:00' }), NOW, LINKED),
    ).toBe(false);
  });

  it('keeps a record exactly 24 h late (inclusive window bound)', () => {
    // windowStart(NOW) = 2026-10-03T10:00 → boundary is eligible.
    expect(
      isEligible(candidate({ date: '2026-10-03', time: '10:00' }), NOW, LINKED),
    ).toBe(true);
  });

  it('skips a record already notified', () => {
    expect(isEligible(candidate({ notified: true }), NOW, LINKED)).toBe(false);
  });

  it('keeps legacy rows whose notified attribute reads null', () => {
    expect(isEligible(candidate({ notified: null }), NOW, LINKED)).toBe(true);
  });

  it('skips a record whose creator has no active subscription', () => {
    expect(
      isEligible(candidate({ createdBy: 'user-b' }), NOW, LINKED),
    ).toBe(false);
  });

  it('reminds a dated note with a time like a task', () => {
    expect(isEligible(candidate({ type: 'note' }), NOW, LINKED)).toBe(true);
  });

  it('skips a record scheduled in the future', () => {
    expect(
      isEligible(candidate({ time: '11:00' }), NOW, LINKED),
    ).toBe(false);
  });

  it('fires exactly at the scheduled minute (inclusive upper bound)', () => {
    expect(isEligible(candidate({ time: '10:00' }), NOW, LINKED)).toBe(true);
  });
});

describe('panamaWallClock (design D2 — Intl, hourCycle h23)', () => {
  it('formats midnight as 00:00, never 24:00', () => {
    // 2026-03-05T05:00:00Z = 2026-03-05T00:00 in Panama (UTC−5).
    expect(panamaWallClock(Date.parse('2026-03-05T05:00:00Z'))).toBe(
      '2026-03-05T00:00',
    );
  });

  it('formats a normal moment as a fixed-width wall-clock string', () => {
    expect(panamaWallClock(Date.parse('2026-03-05T15:07:30Z'))).toBe(
      '2026-03-05T10:07',
    );
  });

  it('stays UTC−5 all year — Panama has no DST', () => {
    const winter = panamaWallClock(Date.parse('2026-01-15T12:00:00Z'));
    const summer = panamaWallClock(Date.parse('2026-07-15T12:00:00Z'));
    expect(winter).toBe('2026-01-15T07:00');
    expect(summer).toBe('2026-07-15T07:00');
  });
});

describe('windowStart (design D2 — wall-clock − 1440 min)', () => {
  it('subtracts exactly one day', () => {
    expect(windowStart('2026-10-04T10:07')).toBe('2026-10-03T10:07');
  });

  it('crosses midnight, month and year boundaries', () => {
    expect(windowStart('2026-03-05T00:00')).toBe('2026-03-04T00:00');
    expect(windowStart('2026-03-01T00:00')).toBe('2026-02-28T00:00');
    expect(windowStart('2026-01-01T00:00')).toBe('2025-12-31T00:00');
  });

  it('is a wall-clock invariant — no DST shifts it (Panama is UTC−5)', () => {
    // Real elapsed time of 24 h == wall-clock 24 h because the zone never
    // changes offset; a DST zone would break this equality.
    expect(windowStart('2026-07-15T07:00')).toBe('2026-07-14T07:00');
  });
});
