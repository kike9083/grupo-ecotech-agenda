import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from '@/instrumentation';
import type { ReminderEnv } from './env';
import {
  LINK_CONFIRMATION_TEXT,
  bootRunners,
  type ReminderRunnerBot,
  type ReminderRunnerDeps,
  type RunnerHandle,
} from './reminder-runner';
import { TelegramCallError, type TelegramUpdate } from './telegram';

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

/**
 * PR5 task 5.3/5.4 (design D4) — the bot loop turns `/start <token>` into the
 * secret-header self-POST against `POST /api/telegram/link`, confirms ONLY on
 * 200, and advances the long-poll offset only past terminal outcomes so a
 * transient failure is re-delivered by Telegram.
 */
function startUpdate(
  updateId: number,
  text: string,
  chatId = 555000111,
): TelegramUpdate {
  return { update_id: updateId, message: { chat: { id: chatId }, text } };
}

/** Bot fed from a queue of responses; records every requested offset. */
function scriptedBot(batches: Array<TelegramUpdate[] | Error>) {
  const offsets: number[] = [];
  const bot: ReminderRunnerBot = {
    getUpdates: async (params) => {
      offsets.push(params.offset ?? 0);
      const next = batches.shift();
      if (next === undefined) {
        return [];
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    sendMessage: vi.fn(async () => ({ status: 'delivered' as const })),
  };
  return { bot, offsets };
}

describe('bot loop /start exchange (spec telegram-linking → Bot callback validation)', () => {
  function bootBot(params: {
    batches: Array<TelegramUpdate[] | Error>;
    postLink: (request: {
      origin: string;
      secret: string;
      token: string;
      chatId: string;
    }) => Promise<{ status: number }>;
    sendMessage?: ReminderRunnerBot['sendMessage'];
    logs?: string[];
    sleeps?: number[];
  }) {
    const { bot, offsets } = scriptedBot(params.batches);
    if (params.sendMessage !== undefined) {
      bot.sendMessage = params.sendMessage;
    }
    bootRunners({
      reminderEnv: enabledEnv(),
      createBot: () => bot,
      postLink: params.postLink,
      tick: parkedTick,
      sleep: recordingSleep(params.sleeps ?? []),
      log: (message) => params.logs?.push(message),
      registerSignal: () => () => {},
    });
    return { bot, offsets };
  }

  async function nextCycle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await settle();
  }

  it('self-POSTs {token, chatId} with the shared secret and confirms on 200', async () => {
    const postLink = vi.fn(async () => ({ status: 200 }));
    const { bot, offsets } = bootBot({
      batches: [[startUpdate(100, '/start tok-1234567890')]],
      postLink,
    });
    await settle();

    expect(postLink).toHaveBeenCalledTimes(1);
    expect(postLink).toHaveBeenCalledWith({
      origin: 'http://127.0.0.1:3000',
      secret: 'link-secret',
      token: 'tok-1234567890',
      chatId: '555000111',
    });
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage).toHaveBeenCalledWith(
      '555000111',
      LINK_CONFIRMATION_TEXT,
      expect.any(AbortSignal),
    );

    // 200 is terminal: the next long poll starts past this update.
    await nextCycle();
    expect(offsets).toEqual([0, 101]);
  });

  it('sends no confirmation on 404 but still advances past the dead token', async () => {
    const postLink = vi.fn(async () => ({ status: 404 }));
    const { bot, offsets } = bootBot({
      batches: [[startUpdate(7, '/start expired-token')]],
      postLink,
    });
    await settle();

    expect(postLink).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage).not.toHaveBeenCalled();

    await nextCycle();
    expect(offsets).toEqual([0, 8]);
  });

  it('keeps the offset when the callback POST fails transiently', async () => {
    const postLink = vi.fn(async () => ({ status: 500 }));
    const { bot, offsets } = bootBot({
      batches: [[startUpdate(42, '/start tok-1234567890')]],
      postLink,
    });
    await settle();

    expect(bot.sendMessage).not.toHaveBeenCalled();

    await nextCycle();
    // The update is re-delivered, exactly as design D4 requires.
    expect(offsets).toEqual([0, 0]);
  });

  it('keeps the offset and honors retryAfterMs when the confirmation is rate-limited', async () => {
    const sleeps: number[] = [];
    const postLink = vi.fn(async () => ({ status: 200 }));
    const { offsets } = bootBot({
      batches: [[startUpdate(10, '/start tok-1234567890')]],
      postLink,
      sleeps,
      sendMessage: vi.fn(async () => ({
        status: 'transient' as const,
        retryAfterMs: 7_000,
      })),
    });
    await settle();

    // 429 → transient + retry_after: the loop waits it out before re-polling.
    expect(sleeps[0]).toBe(7_000);
    await vi.advanceTimersByTimeAsync(7_000);
    await settle();
    await nextCycle();
    expect(offsets).toEqual([0, 0]);
  });

  it('advances past messages that are not a /start command', async () => {
    const postLink = vi.fn(async () => ({ status: 200 }));
    const { bot, offsets } = bootBot({
      batches: [[startUpdate(3, 'hola, ¿qué tal?')]],
      postLink,
    });
    await settle();

    expect(postLink).not.toHaveBeenCalled();
    expect(bot.sendMessage).not.toHaveBeenCalled();

    await nextCycle();
    expect(offsets).toEqual([0, 4]);
  });

  it('ignores a bare /start with no token and advances', async () => {
    const postLink = vi.fn(async () => ({ status: 200 }));
    const { offsets } = bootBot({
      batches: [[startUpdate(9, '/start')]],
      postLink,
    });
    await settle();

    expect(postLink).not.toHaveBeenCalled();

    await nextCycle();
    expect(offsets).toEqual([0, 10]);
  });

  it('never logs the token, the chat id or the bot token (spec telegram-linking → Bot callback validation)', async () => {
    const logs: string[] = [];
    const { bot } = bootBot({
      batches: [
        [startUpdate(1, '/start tok-super-secret-token')],
        new TelegramCallError('getUpdates', 500),
      ],
      postLink: async () => ({ status: 200 }),
      logs,
    });
    await settle();
    await nextCycle();

    const haystack = logs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    expect(haystack).not.toContain('tok-super-secret-token');
    expect(haystack).not.toContain('555000111');
    expect(haystack).not.toContain('bot-token-secret');
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
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
