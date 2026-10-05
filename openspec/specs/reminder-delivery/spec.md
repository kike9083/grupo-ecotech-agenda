# reminder-delivery Specification

## Purpose

Select due records and deliver exactly one reminder per record to its creator through the configured notification channel.

## Assumptions (pending user confirmation)

These four proposal questions were written as assumptions in the change and were NOT overridden by the user. They remain flagged as assumptions — not settled requirements — in the archived spec (agenda-reminders, 2026-10-05).

- Linking is the opt-in: once linked, ALL the user's eligible records remind; there is no per-record toggle in this slice. (Proposal question 1 — confirm to lock.)
- Records in `done`/`cancelled` state are skipped; the late-fire window is 24 h after the scheduled time. (Proposal question 2 — confirm to lock.)
- The reminder fires at the scheduled time exactly — no early lead time. (Proposal question 3 — confirm to lock.)

(Proposal question 4 — manual re-link after a "bot blocked" block, no fallback channel — lives in `telegram-linking` and carries the same pending status.)

## Requirements

### Requirement: Eligibility

A record is eligible when its creator has an active subscription; `date` and `time` are both set; the scheduled moment has passed; it is within 24 h after the scheduled moment; its status is not `done` or `cancelled`; and it is not yet notified. Records without a date or without a time (including undated notes) MUST NOT notify; a dated note with a time reminds like a task.

#### Scenario: Due record fires

- GIVEN A is linked and has an open record dated today with a time now passed
- WHEN the scheduler polls
- THEN A receives a reminder for that record

#### Scenario: Missing date or time never notifies

- GIVEN a record with a date but no time, or with no date at all
- WHEN polls run
- THEN no reminder is produced for it

#### Scenario: Terminal status skipped

- GIVEN a past-schedule record whose status is `done` or `cancelled`
- WHEN the scheduler polls
- THEN no reminder is produced

#### Scenario: Outside late window skipped

- GIVEN an unnotified record scheduled more than 24 h ago
- WHEN the scheduler polls
- THEN no reminder is produced

### Requirement: Poll cadence

Due records MUST be evaluated at least once per poll interval (default 60 s, environment-tunable) so a due reminder is delivered within one interval of its scheduled time. Scheduling MUST be compared on the `America/Panama` wall clock (via `Intl`, `hourCycle: 'h23'`), never by parsing a date-time string with `Date` — the container runs UTC and Panama has no DST.

#### Scenario: Delivered near schedule

- GIVEN a record due at 09:00
- WHEN the scheduler polls
- THEN the reminder goes out within one poll interval after 09:00

### Requirement: Creator-only delivery

A reminder MUST be sent only to the record creator's linked chat. No other user, admin, or viewer MUST receive it.

#### Scenario: Only creator notified

- GIVEN A's due record while another user B is also linked
- WHEN the scheduler polls
- THEN only A's chat receives the message and B receives nothing

### Requirement: Notified marking

A record MUST be marked notified only after a successful send — send-then-mark: the mark is written immediately after each individual send reports delivered, never batched and never before the send. A failed send MUST leave it unnotified; once notified it MUST NOT be sent again, including after a restart.

#### Scenario: Marked after success

- GIVEN a due record
- WHEN the send succeeds
- THEN the record is marked notified

#### Scenario: Unnotified after failure

- GIVEN a due record
- WHEN the send fails
- THEN it stays unnotified and remains eligible on the next poll

#### Scenario: No duplicate after restart

- GIVEN a notified record
- WHEN the container restarts and polls resume
- THEN no second message is sent

### Requirement: Send failure and retry

A transient send failure MUST NOT deactivate the subscription; the record is retried on later polls while still inside the late window. A bot-blocked rejection (403) MUST deactivate the subscription as defined by `telegram-linking`.

#### Scenario: Transient failure retried

- GIVEN a due record whose send fails
- WHEN the next poll runs inside the 24 h window
- THEN the send is attempted again

### Requirement: Restart safety

Reminder state MUST live outside the process, so a restart or redeploy resumes delivery with no lost due records and no duplicate sends. Exactly-once delivery depends on a single always-on replica: the scheduler has no protocol-level duplicate protection (unlike Telegram's 409 on concurrent `getUpdates`, which protects only the bot loop), so running a second replica MUST be treated as a deployment error.

#### Scenario: Resume after restart

- GIVEN unnotified due records
- WHEN the runner stops and starts again
- THEN each pending reminder is still delivered exactly once

### Requirement: Disabled or unconfigured reminders

When reminders are disabled by environment, or the Telegram environment variables are absent, no reminders MUST be sent and the application MUST still boot and operate.

#### Scenario: App boots without env

- GIVEN missing Telegram environment variables
- WHEN the application starts
- THEN it boots normally and sends no notifications

#### Scenario: Disabled by environment

- GIVEN reminders explicitly disabled while due records exist
- WHEN the scheduler runs
- THEN no sends occur

## Implementation Notes (as shipped, agenda-reminders, archived 2026-10-05)

Non-normative; reconciled with the verified implementation.

- Loops boot from Next 15's `src/instrumentation.ts` `register()` (Node runtime only): `bootRunners()` starts the bot `getUpdates` 50 s long-poll and the reminder poll (60 s) as fire-and-forget recursive `setTimeout` loops behind a `globalThis[Symbol.for('agenda.reminders.runner')]` guard — at most one loop pair per process, safe under dev HMR. Errors are caught with backoff `min(interval·2^n, 300 s)` (reset on success) and never crash the server; SIGTERM stops both loops and aborts the in-flight long-poll.
- Time: `panamaWallClock` formats `YYYY-MM-DDTHH:MM` with `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Panama', hourCycle: 'h23' })`; eligibility compares wall-clock strings lexicographically; the 24 h window is computed by wall-clock arithmetic (Panama has no DST).
- Send-then-mark: `tasks.notified` is written by the scheduler only, immediately after each send reports `delivered`; `transient`/`blocked` leave it untouched (blocked deactivates the subscription instead). A crash in the millisecond window between send and mark can produce a rare duplicate — accepted; claim-then-send was rejected because a crash after claiming would lose the reminder.
- Single replica is a hard deployment constraint (README + Easypanel); prod verified with exactly one container. State lives in Appwrite (`telegram_subscriptions`, `tasks.notified`), so restarts resume with no loss.
- Live vs unit evidence for the restart-no-duplicate scenario: unit-tested (`reminders.test.ts` over persisted `notified: true` ⇒ 0 sends); deliberately not replayed against production — see the archived `verify-report.md`.
