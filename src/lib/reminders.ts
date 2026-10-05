import type { NotificationChannel } from './notification-channel';

/**
 * Pure scheduler decide (design D2/D6) — zero I/O, zero imports beyond the
 * channel contract, no provider symbol anywhere in this file (enforced by the
 * source scan, task 6.9: spec `notification-channels` → "Scheduler depends
 * only on the interface").
 *
 * Time is compared as fixed-width Panama wall-clock strings
 * (`YYYY-MM-DDTHH:mm`), so lexicographic comparison IS chronological. Panama
 * (America/Panama) is UTC−5 all year — no DST — which is exactly what makes
 * wall-clock arithmetic equivalent to real arithmetic when walking the late
 * window backwards (design D2 rejects `new Date('YYYY-MM-DDTHH:mm')`: the
 * container runs UTC and the engine would apply a 5 h skew).
 */

/** Record the scheduler inspects — a due query row, nothing UI-shaped. */
export interface ReminderCandidate {
  /** Appwrite document id — the handle used to mark a delivered reminder. */
  $id: string;
  /** `task` or `note` — both remind when dated with a time (spec Eligibility). */
  type: string;
  /** Reminder copy: the same title the list shows (`Recordatorio: <title>`). */
  title: string;
  /** Panama wall-clock day (`YYYY-MM-DD`); `''` = undated → never eligible. */
  date: string;
  /** Zero-padded 24 h time (`HH:mm`); `''` = no time → never eligible. */
  time: string;
  status: string;
  createdBy: string;
  /** `true` only on delivered reminders; legacy rows read `null`. */
  notified?: boolean | null;
}

/** Statuses that must never remind (spec Eligibility → Terminal status skipped). */
const TERMINAL_STATUSES = new Set(['done', 'cancelled']);

/** Late window: 24 h after the scheduled moment (spec Outside late window). */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Fixed-width Panama wall-clock string for an instant.
 *
 * `en-CA` yields `YYYY-MM-DD` parts and `hourCycle: 'h23'` avoids the ICU
 * `24:00` midnight gotcha (design D2), so the output always sorts
 * chronologically.
 */
export function panamaWallClock(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Panama',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

/**
 * Inclusive lower bound of the late window: `nowWall − 1440 min`.
 *
 * Parsed as UTC (`…:00Z`), walked back exactly 24 h and formatted back as a
 * wall-clock string — equivalent to wall-clock subtraction because the zone
 * never changes offset (design D2 "no-DST invariant").
 */
export function windowStart(nowWall: string): string {
  const sinceEpoch = Date.parse(`${nowWall}:00Z`);
  return new Date(sinceEpoch - WINDOW_MS).toISOString().slice(0, 16);
}

/**
 * The eligibility rule of spec `reminder-delivery` → Eligibility, verbatim:
 *
 * - `date` and `time` are both set (undated notes and dateless records never
 *   notify; a dated note with a time reminds like a task);
 * - status is not `done`/`cancelled`;
 * - the creator holds an active subscription (Creator-only delivery's gate);
 * - not yet notified (`notified === true` skips; legacy `null` does not);
 * - `windowStart ≤ scheduled ≤ nowWall` — the moment has passed, but not more
 *   than 24 h ago. Both bounds are inclusive (design D2: the query narrows by
 *   day, this function applies the exact minute bounds).
 *
 * The day bounds in the query are inclusive; this function is the exact
 * minute-level decide. Everything is a string comparison on the wall clock —
 * no `Date` parsing of user input, no `process.env.TZ` mutation.
 */
export function isEligible(
  record: ReminderCandidate,
  nowWall: string,
  linkedCreators: ReadonlySet<string>,
): boolean {
  if (record.date === '' || record.time === '') {
    return false;
  }
  if (TERMINAL_STATUSES.has(record.status)) {
    return false;
  }
  if (!linkedCreators.has(record.createdBy)) {
    return false;
  }
  if (record.notified === true) {
    return false;
  }

  const scheduled = `${record.date}T${record.time}`;
  return windowStart(nowWall) <= scheduled && scheduled <= nowWall;
}

/** Active link the poll delivers to — `chatId === ''` is unlinked (D7). */
export interface ReminderSubscription {
  userId: string;
  chatId: string;
}

/**
 * Storage the poll drives (design D2 seam list + D5's block write). The
 * production shape is `createRemindersApi()`; tests use an in-memory repo, so
 * scheduling is provable with no network, no credentials and no Appwrite
 * (spec `notification-channels` → "Seam proven with a fake channel").
 */
export interface ReminderPollRepo {
  /** Due candidates narrowed by the indexed query (day bounds inclusive). */
  listDue(windowStart: string, nowWall: string): Promise<ReminderCandidate[]>;
  /** Send-then-mark write — called ONLY after a `delivered` outcome (D5). */
  markNotified(id: string): Promise<void>;
  /** Active linked chats (`active: true` and a non-empty chat id). */
  listActiveSubs(): Promise<ReminderSubscription[]>;
  /** 403 from the provider → deactivate the creator's subscription. */
  deactivate(userId: string): Promise<void>;
}

/**
 * One scheduler cycle (spec `reminder-delivery`, design D5/D6).
 *
 * Rules, in order:
 * 1. resolve the Panama wall clock once — every bound below compares against
 *    that single string (design D2);
 * 2. read candidates + active links from the repo (the fake-able seam);
 * 3. **sequential** per-record delivery: eligibility → `channel.send` →
 *    `markNotified` immediately after `delivered` (never batched — the
 *    send-then-mark duplicate window stays per record, D5);
 * 4. outcomes: `delivered` → marked; `transient` → untouched, retried by the
 *    next poll while inside the window; `blocked` → the creator's
 *    subscription deactivates AND is dropped from this run's link map, so no
 *    further send targets that user (linking spec → "Deactivated
 *    subscription on block"; the spec id itself stays out of this file — the
 *    source scan forbids the provider word anywhere in the scheduler).
 *
 * Nothing here knows what a provider is — only `NotificationChannel`.
 */
export async function runReminderPoll(params: {
  channel: NotificationChannel;
  repo: ReminderPollRepo;
  /** Injected clock (epoch ms): tests pin `now`, production passes `Date.now()`. */
  now: number;
}): Promise<void> {
  const nowWall = panamaWallClock(params.now);
  const due = await params.repo.listDue(windowStart(nowWall), nowWall);
  const subscriptions = await params.repo.listActiveSubs();

  const linked = new Map<string, string>();
  for (const subscription of subscriptions) {
    if (subscription.chatId !== '') {
      linked.set(subscription.userId, subscription.chatId);
    }
  }
  const linkedCreators = new Set(linked.keys());

  for (const record of due) {
    if (!isEligible(record, nowWall, linkedCreators)) {
      continue;
    }
    const chatId = linked.get(record.createdBy);
    if (chatId === undefined) {
      continue;
    }

    const outcome = await params.channel.send(
      chatId,
      `Recordatorio: ${record.title}`,
    );

    if (outcome.status === 'delivered') {
      await params.repo.markNotified(record.$id);
    } else if (outcome.status === 'blocked') {
      await params.repo.deactivate(record.createdBy);
      linked.delete(record.createdBy);
      linkedCreators.delete(record.createdBy);
    }
    // `transient`: notified stays untouched — the record remains eligible for
    // the next poll (spec "Unnotified after failure" / "Transient failure
    // retried").
  }
}
