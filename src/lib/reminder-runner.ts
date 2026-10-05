import { loadReminderEnv, type ReminderEnv } from './env';
import {
  GET_UPDATES_TIMEOUT_SECONDS,
  TelegramCallError,
  createTelegramApi,
  type TelegramSendOutcome,
  type TelegramUpdate,
} from './telegram';

/**
 * Reminder runner (design D1): one env-gated `globalThis` record owns two
 * fire-and-forget loops — the bot long poll and the scheduler tick.
 *
 * Why these exact mechanics (design D1):
 * - `globalThis[Symbol.for('agenda.reminders.runner')]` survives module
 *   re-evaluation (dev HMR), so a double boot starts ONE pair of loops;
 * - recursive `setTimeout` instead of `setInterval`: a tick longer than the
 *   interval can never overlap the next one, which is the scheduler's only
 *   defence against double sends (single replica is the other one);
 * - every loop body catches its own errors, backs off
 *   `min(interval · 2^n, 300_000)` and resets on the next success, so a
 *   failing dependency can never crash the server process;
 * - sleeps are `unref()`d and SIGTERM flips the record off and aborts the
 *   in-flight `getUpdates`, so the container exits on the first signal.
 *
 * Tests inject env, bot, callback POST, tick, sleep, log and signal
 * registration: no network, no credentials, fake timers (design D5).
 */

/** The process-wide runner record: `running` drives the loops, `stop()` ends them. */
export interface RunnerHandle {
  running: boolean;
  stop(): void;
}

/** The slice of the Telegram client the bot loop uses (design D3/D4). */
export interface ReminderRunnerBot {
  getUpdates(params: {
    offset?: number;
    timeoutSeconds?: number;
    signal?: AbortSignal;
  }): Promise<TelegramUpdate[]>;
  sendMessage(
    chatId: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<TelegramSendOutcome>;
}

/** Self-POST the bot loop performs against `POST /api/telegram/link` (design D4). */
export interface LinkCallbackRequest {
  origin: string;
  secret: string;
  token: string;
  chatId: string;
}

/** Injected edges of the runner — every one has a production default (D5). */
export interface ReminderRunnerDeps {
  /** Resolved reminder env; defaults to the non-throwing `loadReminderEnv()`. */
  reminderEnv?: ReminderEnv;
  /** Bot client factory; defaults to `createTelegramApi({ token })`. */
  createBot?: (botToken: string) => ReminderRunnerBot;
  /** Link-callback self-POST; defaults to `fetch` against the origin. */
  postLink?: (request: LinkCallbackRequest) => Promise<{ status: number }>;
  /** One scheduler cycle; defaults to the wired tick (task 6.8). */
  tick?: () => Promise<void>;
  /** Inter-cycle wait; defaults to an `unref()`d `setTimeout` (design D1). */
  sleep?: (ms: number) => Promise<void>;
  /** Log sink; defaults to console, errors to stderr. */
  log?: (message: string) => void;
  /** SIGTERM registration; defaults to `process.on('SIGTERM', …)`. */
  registerSignal?: (handler: () => void) => () => void;
}

/** Identity-stable guard key (design D1): `Symbol.for` is per-runtime, not per-module. */
export const RUNNER_GUARD_KEY = Symbol.for('agenda.reminders.runner');

/** Backoff ceiling (design D1): 5 minutes. */
export const MAX_BACKOFF_MS = 300_000;

function defaultLog(message: string): void {
  if (message.startsWith('reminders loop error')) {
    console.error(message);
    return;
  }
  console.info(message);
}

/** Method + status for Telegram failures, message otherwise — never a payload. */
function describeError(error: unknown): string {
  if (error instanceof TelegramCallError) {
    return `${error.method} (HTTP ${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'unknown error';
}

/** `min(interval · 2^n, 300_000)` — n counts consecutive failures (design D1). */
export function backoffMs(intervalMs: number, failures: number): number {
  return Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);
}

type TimerHandle = ReturnType<typeof setTimeout>;

function unrefTimer(handle: TimerHandle): void {
  const candidate = handle as unknown as { unref?: () => void };
  if (typeof candidate.unref === 'function') {
    candidate.unref();
  }
}

/**
 * Inter-cycle sleep with cancellation: `cancel()` clears the pending timer and
 * RESOLVES it, so a stopped runner wakes up, sees `running === false` and
 * leaves the loop instead of parking on a timer nobody will ever fire.
 */
function createSleepKit(override?: (ms: number) => Promise<void>): {
  sleep: (ms: number) => Promise<void>;
  cancel: () => void;
} {
  if (override !== undefined) {
    return { sleep: override, cancel: () => {} };
  }

  let cancelActive: (() => void) | null = null;
  return {
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        const handle = setTimeout(() => {
          cancelActive = null;
          resolve();
        }, ms);
        unrefTimer(handle);
        cancelActive = () => {
          clearTimeout(handle);
          cancelActive = null;
          resolve();
        };
      }),
    cancel: () => {
      cancelActive?.();
    },
  };
}

/**
 * One loop: run `step` until the record stops, backing off after failures and
 * waiting one interval between cycles. Nothing ever escapes — the design
 * guarantees the server process cannot die because a poll failed (D1).
 */
async function runLoop(params: {
  label: 'bot' | 'scheduler';
  intervalMs: number;
  isRunning: () => boolean;
  step: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}): Promise<void> {
  let failures = 0;

  while (params.isRunning()) {
    try {
      await params.step();
      failures = 0;
    } catch (error) {
      if (!params.isRunning()) {
        break;
      }
      failures += 1;
      params.log(`reminders loop error (${params.label}): ${describeError(error)}`);
      await params.sleep(backoffMs(params.intervalMs, failures));
    }

    if (params.isRunning()) {
      await params.sleep(params.intervalMs);
    }
  }
}

/** Default link-callback POST (design D4) — never throws, never logs. */
async function defaultPostLink(
  request: LinkCallbackRequest,
): Promise<{ status: number }> {
  try {
    const response = await fetch(
      `${request.origin}${LINK_CALLBACK_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [LINK_SECRET_HEADER]: request.secret,
        },
        body: JSON.stringify({ token: request.token, chatId: request.chatId }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return { status: response.status };
  } catch {
    // Network/abort failure: no HTTP response. The offset stays put so
    // Telegram re-delivers the update (design D4).
    return { status: 0 };
  }
}

/** Path of the secret-header callback route (design D4). */
export const LINK_CALLBACK_PATH = '/api/telegram/link';

/** Shared-secret header the callback route checks (design D4). */
export const LINK_SECRET_HEADER = 'x-link-secret';

/**
 * One bot cycle: long poll, then hand every update to the `/start` handler.
 * The offset only advances past terminal outcomes — a transient one keeps it
 * so Telegram re-delivers (design D4).
 */
async function pollBotOnce(params: {
  bot: ReminderRunnerBot;
  env: Extract<ReminderEnv, { enabled: true }>;
  deps: ReminderRunnerDeps;
  signal: AbortSignal;
  state: { offset: number };
}): Promise<void> {
  const updates = await params.bot.getUpdates({
    offset: params.state.offset,
    timeoutSeconds: GET_UPDATES_TIMEOUT_SECONDS,
    signal: params.signal,
  });

  for (const update of updates) {
    const terminal = await handleUpdate(update, params);
    if (!terminal) {
      return;
    }
    params.state.offset = update.update_id + 1;
  }
}

/**
 * Dispatch one update (design D4). PR5 task 5.4 fills in the `/start` exchange
 * -- until then every update is terminal and simply skipped.
 */
async function handleUpdate(
  update: TelegramUpdate,
  params: {
    bot: ReminderRunnerBot;
    env: Extract<ReminderEnv, { enabled: true }>;
    deps: ReminderRunnerDeps;
    signal: AbortSignal;
    state: { offset: number };
  },
): Promise<boolean> {
  void update;
  void params;
  return true;
}

/**
 * Boots the runner at most once per process (design D1). Never throws:
 * an unconfigured environment logs one line and starts zero timers, so the
 * application boots with no Telegram setup at all (spec `reminder-delivery`
 * → "Disabled or unconfigured reminders").
 */
export function bootRunners(deps: ReminderRunnerDeps = {}): RunnerHandle {
  const existing = Reflect.get(globalThis, RUNNER_GUARD_KEY) as
    | RunnerHandle
    | undefined;
  if (existing !== undefined) {
    return existing;
  }

  const log = deps.log ?? defaultLog;
  const sleepKit = createSleepKit(deps.sleep);
  const abort = new AbortController();
  const reminderEnv = deps.reminderEnv ?? loadReminderEnv();

  let unsubscribeSignal: (() => void) | null = null;

  const record: RunnerHandle = {
    running: false,
    stop(): void {
      if (!record.running) {
        return;
      }
      record.running = false;
      abort.abort();
      sleepKit.cancel();
      if (unsubscribeSignal !== null) {
        unsubscribeSignal();
        unsubscribeSignal = null;
      }
    },
  };
  Reflect.set(globalThis, RUNNER_GUARD_KEY, record);

  if (!reminderEnv.enabled) {
    log(`reminders disabled: ${reminderEnv.reason}`);
    return record;
  }

  const env = reminderEnv;
  const intervalMs = env.pollSeconds * 1000;
  record.running = true;

  const registerSignal = deps.registerSignal ?? defaultRegisterSignal;
  unsubscribeSignal = registerSignal(record.stop);

  const bot = (deps.createBot ?? ((token: string) => createTelegramApi({ token })))(
    env.botToken,
  );
  const tick = deps.tick ?? defaultSchedulerTick;
  const botState = { offset: 0 };

  void runLoop({
    label: 'bot',
    intervalMs,
    isRunning: () => record.running,
    step: () =>
      pollBotOnce({ bot, env, deps, signal: abort.signal, state: botState }),
    sleep: sleepKit.sleep,
    log,
  });

  void runLoop({
    label: 'scheduler',
    intervalMs,
    isRunning: () => record.running,
    step: tick,
    sleep: sleepKit.sleep,
    log,
  });

  return record;
}

function defaultRegisterSignal(handler: () => void): () => void {
  process.on('SIGTERM', handler);
  return () => {
    process.off('SIGTERM', handler);
  };
}

/**
 * Scheduler cycle placeholder: PR5 lands the lifecycle, PR6 task 6.8 wires
 * `runReminderPoll({ channel, repo, now })` in here.
 */
async function defaultSchedulerTick(): Promise<void> {
  // Wired to the reminder poll in task 6.8.
}
