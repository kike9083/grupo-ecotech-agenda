import { describe, expect, it } from 'vitest';
import type { NotificationChannel, ChannelOutcome } from './notification-channel';
import {
  isEligible,
  panamaWallClock,
  runReminderPoll,
  windowStart,
  type ReminderCandidate,
  type ReminderPollRepo,
} from './reminders';

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
    title: 'Pagar el agua',
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

/** 2026-10-04T15:00Z = 10:00 in Panama — records below are due at 09:00. */
const NOW_MS = Date.parse('2026-10-04T15:00:00Z');

function dueRecord(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    $id: 'rec-1',
    type: 'task',
    title: 'Pagar el agua',
    date: '2026-10-04',
    time: '09:00',
    status: 'open',
    createdBy: 'user-a',
    notified: null,
    ...overrides,
  };
}

interface StoredSubscription {
  userId: string;
  chatId: string;
  active: boolean;
}

/**
 * In-memory repo standing in for `appwrite/reminders.ts` (design D6: the seam
 * proven with a fake — no network, no credentials, no Appwrite).
 */
function memoryRepo(
  records: ReminderCandidate[],
  subscriptions: StoredSubscription[],
) {
  const state = {
    records: records.map((record) => ({ ...record })),
    subscriptions: subscriptions.map((subscription) => ({ ...subscription })),
    marks: [] as string[],
    deactivations: [] as string[],
  };

  const repo: ReminderPollRepo = {
    async listDue() {
      return state.records;
    },
    async markNotified(id) {
      state.marks.push(id);
      const record = state.records.find((candidate) => candidate.$id === id);
      if (record !== undefined) {
        record.notified = true;
      }
    },
    async listActiveSubs() {
      return state.subscriptions
        .filter((subscription) => subscription.active && subscription.chatId !== '')
        .map(({ userId, chatId }) => ({ userId, chatId }));
    },
    async deactivate(userId) {
      state.deactivations.push(userId);
      const subscription = state.subscriptions.find((sub) => sub.userId === userId);
      if (subscription !== undefined) {
        subscription.active = false;
      }
    },
  };

  return { state, repo };
}

/** Fake channel recording `(target, text)` pairs (spec Seam proven with a fake). */
function fakeChannel(outcomeFor?: (target: string) => ChannelOutcome) {
  const sends: Array<{ target: string; text: string }> = [];
  const channel: NotificationChannel = {
    id: 'fake',
    async send(target, text) {
      sends.push({ target, text });
      return outcomeFor?.(target) ?? { status: 'delivered' };
    },
  };
  return { channel, sends };
}

describe('runReminderPoll (specs reminder-delivery + notification-channels seam)', () => {
  it('sends one reminder to the creator only (spec Creator-only delivery → Only creator notified)', async () => {
    const { repo } = memoryRepo(
      [dueRecord()],
      [
        { userId: 'user-a', chatId: '555000111', active: true },
        { userId: 'user-b', chatId: '555000222', active: true },
      ],
    );
    const { channel, sends } = fakeChannel();

    await runReminderPoll({ channel, repo, now: NOW_MS });

    expect(sends).toEqual([
      { target: '555000111', text: 'Recordatorio: Pagar el agua' },
    ]);
  });

  it('marks the record notified only after a delivered send (spec Notified marking)', async () => {
    const { state, repo } = memoryRepo([dueRecord()], [
      { userId: 'user-a', chatId: '555000111', active: true },
    ]);
    const { channel, sends } = fakeChannel();

    await runReminderPoll({ channel, repo, now: NOW_MS });

    expect(sends).toHaveLength(1);
    expect(state.marks).toEqual(['rec-1']);
    expect(state.records[0]?.notified).toBe(true);
  });

  it('leaves a transient failure unnotified and retries on the next poll (spec Send failure and retry)', async () => {
    const { state, repo } = memoryRepo([dueRecord()], [
      { userId: 'user-a', chatId: '555000111', active: true },
    ]);
    let failing = true;
    const { channel, sends } = fakeChannel(() =>
      failing ? { status: 'transient' } : { status: 'delivered' },
    );

    await runReminderPoll({ channel, repo, now: NOW_MS });
    expect(sends).toHaveLength(1);
    expect(state.records[0]?.notified).toBe(null);
    expect(state.marks).toEqual([]);

    failing = false;
    await runReminderPoll({ channel, repo, now: NOW_MS });

    expect(sends).toHaveLength(2);
    expect(state.records[0]?.notified).toBe(true);
    expect(state.marks).toEqual(['rec-1']);
  });

  it('deactivates on blocked and never sends to that user again (spec telegram-linking → Deactivated subscription on block)', async () => {
    const { state, repo } = memoryRepo(
      [dueRecord({ $id: 'rec-1' }), dueRecord({ $id: 'rec-2', time: '09:30' })],
      [{ userId: 'user-a', chatId: '555000111', active: true }],
    );
    const { channel, sends } = fakeChannel(() => ({ status: 'blocked' }));

    await runReminderPoll({ channel, repo, now: NOW_MS });

    // The second record of the SAME creator is skipped once the first is
    // blocked — "no further sends are attempted for that user".
    expect(sends).toHaveLength(1);
    expect(state.deactivations).toEqual(['user-a']);
    expect(state.subscriptions[0]?.active).toBe(false);
    expect(state.marks).toEqual([]);
    expect(state.records.every((record) => record.notified !== true)).toBe(true);

    await runReminderPoll({ channel, repo, now: NOW_MS });
    expect(sends).toHaveLength(1);
  });

  it('never repeats a delivered record, even across a fresh run (spec No duplicate after restart)', async () => {
    const { state, repo } = memoryRepo([dueRecord()], [
      { userId: 'user-a', chatId: '555000111', active: true },
    ]);
    const { channel, sends } = fakeChannel();

    await runReminderPoll({ channel, repo, now: NOW_MS });
    expect(sends).toHaveLength(1);
    expect(state.records[0]?.notified).toBe(true);

    // "Container restarts and polls resume": state is read back from the
    // external store, not from any in-process bookkeeping.
    await runReminderPoll({ channel, repo, now: NOW_MS });
    expect(sends).toHaveLength(1);
    expect(state.marks).toEqual(['rec-1']);
  });

  it('sends nothing while no creator holds an active subscription (link opt-in off)', async () => {
    const { state, repo } = memoryRepo([dueRecord()], []);
    const { channel, sends } = fakeChannel();

    await runReminderPoll({ channel, repo, now: NOW_MS });

    expect(sends).toEqual([]);
    expect(state.marks).toEqual([]);
  });

  it('skips an unlinked creator even when the record is due', async () => {
    const { repo } = memoryRepo(
      [dueRecord({ createdBy: 'user-c' })],
      [
        { userId: 'user-a', chatId: '555000111', active: true },
        { userId: 'user-c', chatId: '', active: false },
      ],
    );
    const { channel, sends } = fakeChannel();

    await runReminderPoll({ channel, repo, now: NOW_MS });

    expect(sends).toEqual([]);
  });
});
