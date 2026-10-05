/**
 * Pure scheduler decide (design D2/D6) — zero I/O, zero imports, no provider
 * symbol anywhere in this file (enforced by the source scan, task 6.9: spec
 * `notification-channels` → "Scheduler depends only on the interface").
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
