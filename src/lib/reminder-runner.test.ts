import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from '@/instrumentation';
import type { ReminderEnv } from './env';
import {
  bootRunners,
  type ReminderRunnerBot,
  type ReminderRunnerDeps,
  type RunnerHandle,
} from './reminder-runner';

/**
 * PR5 task 5.1 (design D1) — runner lifecycle:
 *
 * - one `globalThis[Symbol.for('agenda.reminders.runner')]` record per process,
 *   so a double boot (dev HMR re-import, instrumentation re-run) starts ONE
 *   pair of loops;
 * - a disabled / unconfigured environment logs `reminders disabled:` and
 *   starts ZERO timers (spec `reminder-delivery` → "Disabled or unconfigured
 *   reminders");
 * - a failing loop backs off `min(interval · 2^n, 300_000)` and resets on the
 *   next success (design D1 loop body);
 * - SIGTERM flips the record to not-running and aborts the in-flight long poll.
 *
 * Everything is injected (env, bot, tick, sleep, log, signal registration) so
 * the suite runs on fake timers with no network and no credentials.
 */

const GUARD_KEY = Symbol.for('agenda.reminders.runner');
const INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 300_000;

function guard(): RunnerHandle | undefined {
  return Reflect.get(globalThis, GUARD_KEY) as RunnerHandle | undefined;
}

function resetGuard(): void {
  Reflect.deleteProperty(globalThis, GUARD_KEY);
}

function enabledEnv(pollSeconds = 60): ReminderEnv {
  return {
    enabled: true,
    botToken: 'bot-token-secret',
    botUsername: 'agenda_eco_bot',
    linkSecret: 'link-secret',
    callbackOrigin: 'http://127.0.0.1:3000',
    pollSeconds,
  };
}

/** Bot parked inside `getUpdates` — scheduler-focused tests see no bot sleeps. */
function parkedBot(): ReminderRunnerBot {
  return {
    getUpdates: () => new Promise(() => {}),
    sendMessage: vi.fn(async () => ({ status: 'delivered' as const })),
  };
}

/** Tick parked forever — bot-focused tests see no scheduler sleeps. */
function parkedTick(): Promise<void> {
  return new Promise(() => {});
}

/** Flush the microtask queue so fire-and-forget loops reach their next await. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
  }
}

/** Recording sleep that still parks on a (fake) timer, exactly like the default. */
function recordingSleep(budget: number[]): (ms: number) => Promise<void> {
  return (ms: number) => {
    budget.push(ms);
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetGuard();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  resetGuard();
});

describe('runner lifecycle (design D1 — globalThis singleton)', () => {
  it('stores exactly one handle on globalThis[Symbol.for("agenda.reminders.runner")]', async () => {
    const createBot = vi.fn(() => ({
      getUpdates: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({ status: 'delivered' as const })),
    }));
    const deps: ReminderRunnerDeps = {
      reminderEnv: enabledEnv(),
      createBot,
      tick: parkedTick,
      registerSignal: () => () => {},
    };

    const first = bootRunners(deps);
    await settle();

    expect(guard()).toBe(first);
    expect(first.running).toBe(true);
    expect(createBot).toHaveBeenCalledTimes(1);

    const second = bootRunners(deps);
    await settle();

    expect(second).toBe(first);
    // A second boot must not start a second long-poll loop.
    expect(createBot).toHaveBeenCalledTimes(1);
  });

  it('boots with no Telegram environment at all and starts no timers', () => {
    const logs: string[] = [];
    const createBot = vi.fn(parkedBot);

    const handle = bootRunners({
      createBot,
      tick: parkedTick,
      log: (message) => logs.push(message),
      registerSignal: () => () => {},
    });

    expect(handle.running).toBe(false);
    expect(guard()).toBe(handle);
    expect(vi.getTimerCount()).toBe(0);
    expect(createBot).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('reminders disabled:');
  });

  it('logs one line and starts no timers when the environment is disabled', () => {
    const logs: string[] = [];
    const createBot = vi.fn(parkedBot);

    const handle = bootRunners({
      reminderEnv: { enabled: false, reason: 'REMINDERS_ENABLED=false' },
      createBot,
      tick: parkedTick,
      log: (message) => logs.push(message),
      registerSignal: () => () => {},
    });

    expect(handle.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(createBot).not.toHaveBeenCalled();
    expect(logs).toEqual(['reminders disabled: REMINDERS_ENABLED=false']);
  });
});

describe('loop error backoff (design D1 — min(interval·2^n, 300_000))', () => {
  it('grows the delay per consecutive failure, caps it and resets on success', async () => {
    const sleeps: number[] = [];
    const logs: string[] = [];
    let failuresLeft = 3;
    const tick = vi.fn(async () => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('repo unavailable');
      }
    });

    bootRunners({
      reminderEnv: enabledEnv(),
      createBot: parkedBot,
      tick,
      sleep: recordingSleep(sleeps),
      log: (message) => logs.push(message),
      registerSignal: () => () => {},
    });

    // cycle 1: failure → 2¹ · interval, then the regular inter-tick gap
    await settle();
    expect(sleeps).toEqual([INTERVAL_MS * 2]);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    await settle();
    expect(sleeps).toEqual([INTERVAL_MS * 2, INTERVAL_MS]);

    // cycle 2: failure → 2² · interval, then the gap again
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await settle();
    expect(sleeps).toEqual([INTERVAL_MS * 2, INTERVAL_MS, INTERVAL_MS * 4]);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);
    await settle();
    expect(sleeps).toEqual([
      INTERVAL_MS * 2,
      INTERVAL_MS,
      INTERVAL_MS * 4,
      INTERVAL_MS,
    ]);

    // cycle 3: failure → 2³ · interval, capped at 300 s
    expect(INTERVAL_MS * 8).toBeGreaterThan(MAX_BACKOFF_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await settle();
    expect(sleeps).toEqual([
      INTERVAL_MS * 2,
      INTERVAL_MS,
      INTERVAL_MS * 4,
      INTERVAL_MS,
      MAX_BACKOFF_MS,
    ]);
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);
    await settle();
    expect(sleeps).toEqual([
      INTERVAL_MS * 2,
      INTERVAL_MS,
      INTERVAL_MS * 4,
      INTERVAL_MS,
      MAX_BACKOFF_MS,
      INTERVAL_MS,
    ]);

    // cycle 4: success → the ladder resets (plain interval, no backoff)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await settle();
    expect(tick).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([
      INTERVAL_MS * 2,
      INTERVAL_MS,
      INTERVAL_MS * 4,
      INTERVAL_MS,
      MAX_BACKOFF_MS,
      INTERVAL_MS,
      INTERVAL_MS,
    ]);

    // cycle 5: the next failure starts over at 2¹ · interval
    failuresLeft = 1;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await settle();
    expect(sleeps).toHaveLength(8);
    expect(sleeps[7]).toBe(INTERVAL_MS * 2);
    expect(
      logs.filter((line) => line.includes('reminders loop error')),
    ).toHaveLength(4);
  });

  it('keeps the process alive: a loop failure never escapes the runner', async () => {
    const logs: string[] = [];
    const boot = () =>
      bootRunners({
        reminderEnv: enabledEnv(),
        createBot: () => ({
          // The bot loop itself blows up on every poll.
          getUpdates: vi.fn(async () => {
            throw new Error('telegram unreachable');
          }),
          sendMessage: vi.fn(async () => ({ status: 'delivered' as const })),
        }),
        tick: async () => {
          throw new Error('repo unavailable');
        },
        sleep: recordingSleep([]),
        log: (message) => logs.push(message),
        registerSignal: () => () => {},
      });

    expect(boot).not.toThrow();
    await settle();

    expect(guard()?.running).toBe(true);
    expect(logs.some((line) => line.includes('reminders loop error'))).toBe(true);
  });
});

describe('SIGTERM shutdown (design D1 — stop + abort in-flight getUpdates)', () => {
  it('marks the runner stopped and aborts the pending long poll', async () => {
    const handlers: Array<() => void> = [];
    const signalsSeen: AbortSignal[] = [];
    const createBot = vi.fn(() => ({
      getUpdates: vi.fn((params: { signal?: AbortSignal }) => {
        if (params.signal !== undefined) {
          signalsSeen.push(params.signal);
        }
        return new Promise<never>(() => {});
      }),
      sendMessage: vi.fn(async () => ({ status: 'delivered' as const })),
    }));

    const handle = bootRunners({
      reminderEnv: enabledEnv(),
      createBot,
      tick: parkedTick,
      log: () => {},
      registerSignal: (handler) => {
        handlers.push(handler);
        return () => {
          const index = handlers.indexOf(handler);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        };
      },
    });
    await settle();

    expect(createBot).toHaveBeenCalledTimes(1);
    expect(signalsSeen).toHaveLength(1);
    expect(signalsSeen[0]?.aborted).toBe(false);

    handlers.forEach((handler) => handler());
    await settle();

    expect(handle.running).toBe(false);
    expect(signalsSeen[0]?.aborted).toBe(true);

    // The stopped loop never polls again.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10);
    await settle();
    expect(createBot).toHaveBeenCalledTimes(1);
  });
});

describe('instrumentation register() (design D1 — never breaks boot)', () => {
  it('is a no-op outside the nodejs runtime', async () => {
    const previous = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = 'edge';
    try {
      await register();
      expect(guard()).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_RUNTIME;
      } else {
        process.env.NEXT_RUNTIME = previous;
      }
    }
  });

  it('boots the runners under nodejs with zero Telegram env and never throws', async () => {
    const previous = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = 'nodejs';
    try {
      await expect(register()).resolves.toBeUndefined();
      expect(guard()?.running).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_RUNTIME;
      } else {
        process.env.NEXT_RUNTIME = previous;
      }
    }
  });
});
