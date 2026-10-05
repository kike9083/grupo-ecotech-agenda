import { Databases } from 'node-appwrite';
import { loadEnv, loadReminderEnv, type ReminderEnv } from './env';
import { createAdminClient } from './appwrite/clients';
import { createRemindersApi } from './appwrite/reminders';
import {
  TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
  createTelegramSubscriptionsApi,
} from './appwrite/telegram';
import { runReminderPoll } from './reminders';
import { createTelegramChannel } from './telegram-channel';
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
 * Confirmation sent ONLY after the callback answered 200 (spec
 * `telegram-linking` → "Bot callback validation" — a 404 must stay silent so
 * a dead token never leaks whether it existed).
 */
export const LINK_CONFIRMATION_TEXT =
  'Vinculación correcta. Ya recibirás tus recordatorios aquí.';

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
  sleep: (ms: number) => Promise<void>;
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

/** `/start[?@bot] [token]` → the deep-link token, or undefined. */
function startToken(update: TelegramUpdate): string | undefined {
  const text = update.message?.text;
  if (text === undefined) {
    return undefined;
  }
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(text);
  return match?.[1];
}

/**
 * Dispatch one update (design D4). Returns `true` when the outcome is
 * terminal — the offset may advance past it — and `false` when Telegram
 * should re-deliver the same update on the next poll.
 *
 * Contract:
 * - not `/start <token>` → terminal, silent (nothing to link);
 * - callback 200 → confirmation, terminal;
 * - callback 404 (and any other 4xx) → terminal, silent (dead token: a 404
 *   must not be retried forever, and must never be answered);
 * - callback 5xx / network failure → transient, silent;
 * - confirmation send `transient` (429 → `retryAfterMs`) → wait out the
 *   retry delay and stay transient so the whole exchange is re-delivered.
 *
 * Logs only describe *what* failed — never the token, the chat id or the
 * bot token (spec `telegram-linking` → "Bot callback validation").
 */
async function handleUpdate(
  update: TelegramUpdate,
  params: {
    bot: ReminderRunnerBot;
    env: Extract<ReminderEnv, { enabled: true }>;
    deps: ReminderRunnerDeps;
    signal: AbortSignal;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<boolean> {
  const token = startToken(update);
  if (token === undefined || update.message?.chat === undefined) {
    return true;
  }

  const postLink = params.deps.postLink ?? defaultPostLink;
  let status: number;
  try {
    const result = await postLink({
      origin: params.env.callbackOrigin,
      secret: params.env.linkSecret,
      token,
      chatId: String(update.message.chat.id),
    });
    status = result.status;
  } catch {
    status = 0;
  }

  if (status === 0 || status >= 500) {
    return false;
  }
  if (status !== 200) {
    return true;
  }

  const outcome = await params.bot.sendMessage(
    String(update.message.chat.id),
    LINK_CONFIRMATION_TEXT,
    params.signal,
  );
  if (outcome.status !== 'transient') {
    return true;
  }

  const retryAfterMs = outcome.retryAfterMs;
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    await params.sleep(retryAfterMs);
  }
  return false;
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
  const tick = deps.tick ?? createSchedulerTick(env.botToken);
  const botState = { offset: 0 };

  void runLoop({
    label: 'bot',
    intervalMs,
    isRunning: () => record.running,
    step: () =>
      pollBotOnce({
        bot,
        env,
        deps,
        signal: abort.signal,
        sleep: sleepKit.sleep,
        state: botState,
      }),
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
 * Production scheduler cycle (task 6.8): the one composition root of PR6 —
 * Appwrite admin client + subscriptions + reminders repo (design D2 data
 * flow) bound to the provider channel (design D6), driving the pure poll.
 *
 * Built lazily inside the cycle (never at module load) and re-resolved every
 * tick: an unconfigured or broken dependency throws into `runLoop`'s catch,
 * so the loop backs off instead of crashing the process (design D1). The bot
 * token comes from the already-validated enabled env, never from a raw read.
 */
function createSchedulerTick(botToken: string): () => Promise<void> {
  return async () => {
    const env = loadEnv();
    const databases = new Databases(createAdminClient(env));

    const subscriptions = createTelegramSubscriptionsApi(databases, {
      databaseId: env.APPWRITE_DATABASE_ID,
      collectionId: TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
    });
    const repo = createRemindersApi(
      databases,
      {
        databaseId: env.APPWRITE_DATABASE_ID,
        tasksCollectionId: env.APPWRITE_TASKS_COLLECTION_ID,
      },
      subscriptions,
    );
    const channel = createTelegramChannel(createTelegramApi({ token: botToken }));

    await runReminderPoll({ channel, repo, now: Date.now() });
  };
}
