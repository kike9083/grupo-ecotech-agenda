# Tasks: agenda-reminders (slice 2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,600 (range 1,800–2,600); per PR: 370 / 320 / 340 / 390 / 390 / 395 / 390 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 reminders-schema → PR2 subscription-data → PR3 telegram-client → PR4 linking → PR5 bot-runner → PR6 scheduler → PR7 link-ui-deploy |
| Delivery strategy | auto-forecast — recorded, not asked |
| Chain strategy | stacked-to-main (each PR < 400 lines, green, revert = revert that PR) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base boundary |
|------|------|-----------|---------------|
| 1 | Provisioning script + env contract | PR1 | main |
| 2 | Subscription data access | PR2 | PR1 |
| 3 | Telegram API client (transport, outcomes, redaction) | PR3 | PR2 |
| 4 | Token exchange + callback route + matcher exclusion | PR4 | PR3 |
| 5 | Bot loop + runner lifecycle (instrumentation) | PR5 | PR4 |
| 6 | Channel seam + eligibility + scheduler + notified | PR6 | PR5 |
| 7 | Link UI + home entry + README/Easypanel docs | PR7 | PR6 |

TDD note: `strict_tdd: true` — every behavior batch has an explicit RED task (named test file + scenarios) before its GREEN task; infra tasks (live provisioning, docs, env) are marked "no tests possible". Gate after each PR: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## Phase 1: PR1 — reminders-schema (env + provisioning, ~370)

- [x] 1.1 RED `src/lib/env.test.ts`: `loadReminderEnv()` — all three `TELEGRAM_*` present → enabled (pollSeconds default 60, invalid falls back); any missing → `{enabled:false, reason}`; `REMINDERS_ENABLED=false` → disabled; never throws. Spec: reminder-delivery#Disabled or unconfigured reminders (both scenarios). AC: fails first.
- [x] 1.2 GREEN `src/lib/env.ts`: non-throwing `loadReminderEnv()` → `ReminderEnv` union (design Interfaces); existing fail-fast loader untouched.
- [x] 1.3 Infra (no tests possible — live provisioning): create `scripts/provision-reminders.ts` (idempotent raw-fetch, `provision-notebook.ts` precedent): `telegram_subscriptions` — 5 attrs (`userId`/`chatId`/`active`/`token`/`tokenExpiresAt`) + `user_id` unique + `token` key indexes, perms per D7, GET-state-then-create, wait-`available`. AC: re-run is a no-op; never touches `crm-ge`/`ecotech_sitio_web`.
- [x] 1.4 Probe (1.8.1 unverified): `agenda.tasks` + `notified` boolean `required:false` with `default:false`; on rejection retry without `default`; no backfill, no index. AC: read path treats anything `!== true` as unnotified.
- [x] 1.5 Run once: `node scripts/provision-reminders.ts` (API key in existing `.env.local`; no Telegram token needed). AC: collection/indexes/`notified` exist; second run all SKIP.
- [x] 1.6 Infra (no tests possible — env contract): `.env.example` gains the 6 optional keys from design Env Contract (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_LINK_SECRET`, `REMINDERS_ENABLED`, `REMINDERS_POLL_SECONDS`, `TELEGRAM_CALLBACK_ORIGIN`); none `NEXT_PUBLIC_*`. Spec: reminder-delivery#Disabled or unconfigured reminders.
- [x] 1.7 Gates: `npx tsc --noEmit`, `npx vitest run` green.

## Phase 2: PR2 — subscription-data (~320)

- [x] 2.1 RED `src/lib/appwrite/telegram.test.ts`: fake `Databases` — upsert-per-user create with `$permissions` (owner + `team:admins`, doc `user:<uid>`), `getByUser` via `Query.equal('userId',uid)` limit 1, `listActiveSubs` active-only uid→chatId, consume update `{chatId, active:true, token:'', tokenExpiresAt:''}`, `deactivate`, `unlink`. Specs: telegram-linking#Link status and unlink, #Deactivated subscription on block. AC: fails first.
- [x] 2.2 GREEN `src/lib/appwrite/telegram.ts`: injected client — session client for status/unlink, API-key client for exchange/active listing (D7 split).
- [x] 2.3 Gates: `npx tsc --noEmit`, `npx vitest run` green.

## Phase 3: PR3 — telegram-client (~340)

- [x] 3.1 RED `src/lib/telegram.test.ts`: fake `Transport` (no network, no credentials) — `getUpdates` sends `offset`/`timeoutSeconds:50`/`signal`; `sendMessage`; 200→`delivered`, 403→`blocked`, 429→`transient`+`retryAfterMs`, 5xx/network→`transient`; `TelegramCallError{method,status}` never leaks token/chat id/URL. Specs: telegram-linking#Bot callback validation (no logging), reminder-delivery#Send failure and retry, notification-channels#Channel contract (Blocked outcome). AC: fails first.
- [x] 3.2 GREEN `src/lib/telegram.ts`: `createTelegramApi({token, transport})`, default fetch transport + `AbortSignal.timeout`, outcome mapping, logs = method + status only.
- [x] 3.3 Gates: `npx tsc --noEmit`, `npx vitest run` green.

## Phase 4: PR4 — linking (domain + route + matcher, ~390)

- [x] 4.1 RED `src/lib/telegram-link.test.ts`: fake repo + fake clock — mint = `crypto.randomBytes(32).toString('base64url')`, TTL 10 min, re-mint overwrites (old deep link dies); unknown/expired/used → uniform 404 (no oracle); success → single consume; same-chatId re-`/start` → `already-linked` success without consuming; deactivated → active again. Specs: telegram-linking#Link initiation (Mint link, Expired token rejected), #Bot callback validation (Successful exchange, Reused token rejected), #Deactivated subscription on block (Re-link restores delivery). AC: fails first.
- [x] 4.2 GREEN `src/lib/telegram-link.ts`: `mintTelegramLink`, `buildDeepLink` (`https://t.me/<username>?start=<token>`), `exchangeLinkToken`.
- [x] 4.3 RED `src/app/api/telegram/link/route.test.ts`: missing/wrong `x-link-secret` → 401 without touching storage (length-guarded `timingSafeEqual`), bad token → 404, valid → 200; mocked domain. Spec: telegram-linking#Bot callback validation (Missing secret header rejected, Successful exchange). AC: fails first.
- [x] 4.4 GREEN `src/app/api/telegram/link/route.ts`: secret gate → `exchangeLinkToken`.
- [x] 4.5 RED `src/lib/middleware-matcher.test.ts`: `matchesMiddleware('/api/telegram/link')` → `false` while `/`, `/nota`, `/api/attachments/abc123` stay `true`; literal-sync guard still passes. AC: fails first (F1 precedent).
- [x] 4.6 GREEN `src/lib/middleware-matcher.ts` + inlined literal in `src/middleware.ts`. Spec: design D4.
- [x] 4.7 Gates: `npx tsc --noEmit`, `npx vitest run` green.

## Phase 5: PR5 — bot-runner (instrumentation + loops, ~390)

- [x] 5.1 RED `src/lib/reminder-runner.test.ts` (`vi.useFakeTimers`, reset `globalThis` guard per test): double boot → 1 record on `globalThis[Symbol.for('agenda.reminders.runner')]`; disabled env → 0 timers + one `reminders disabled:` log; loop error → backoff `min(interval·2^n, 300_000)` then reset on success; SIGTERM → stop + abort in-flight `getUpdates`. Specs: reminder-delivery#Disabled or unconfigured reminders, #Restart safety (Resume after restart). AC: fails first.
- [x] 5.2 GREEN `src/lib/reminder-runner.ts` + `src/instrumentation.ts`: `register()` (nodejs guard → `bootRunners()`, fire-and-forget, never throws), recursive `setTimeout` loops (bot 50 s + scheduler tick), `unref()` sleeps, SIGTERM handler.
- [x] 5.3 RED `src/lib/reminder-runner.test.ts`: bot loop on `/start <token>` self-POSTs `{token, chatId}` to `TELEGRAM_CALLBACK_ORIGIN` with `x-link-secret`; Spanish confirmation only on 200; offset advances only on terminal outcome, transient keeps it; token/chatId absent from logs. Spec: telegram-linking#Bot callback validation (Successful exchange — confirmation arrives). AC: fails first.
- [x] 5.4 GREEN bot-loop handling in `src/lib/reminder-runner.ts` (idempotent `/start`, 429 honors `retryAfterMs`).
- [x] 5.5 Gates: `npx tsc --noEmit`, `npx vitest run` green.

## Phase 6: PR6 — scheduler (seam + eligibility + delivery, ~395)

- [x] 6.1 RED `src/lib/telegram-channel.test.ts`: 200→`delivered`, 403→`blocked`, 429→`transient`+`retryAfterMs`, 5xx/network→`transient` (fake transport). Spec: notification-channels#Channel contract (Delivered outcome, Blocked outcome). AC: fails first.
- [x] 6.2 GREEN `src/lib/notification-channel.ts` (`ChannelOutcome` + `NotificationChannel`) + `src/lib/telegram-channel.ts` (`createTelegramChannel`).
- [x] 6.3 RED `src/lib/reminders.test.ts`: table-driven `isEligible` fixed `nowWall` — due fires; date-without-time and undated never; `done`/`cancelled` skipped; >24 h late window skipped; `notified===true` skipped; unlinked creator skipped; dated note with time eligible; + `panamaWallClock` midnight `h23` + `windowStart` no-DST. Spec: reminder-delivery#Eligibility (all 4 scenarios). AC: fails first.
- [x] 6.4 GREEN `src/lib/reminders.ts`: pure `isEligible`, `panamaWallClock`, `windowStart` — zero I/O, no provider import.
- [x] 6.5 RED `src/lib/appwrite/reminders.test.ts`: fake `Databases` asserting exact query JSON (`Query.equal('status',['open','in_progress'])`, `between('date',…)`, `orderAsc('date')`+`orderAsc('time')`, `limit(100)`), `markNotified(id)`, `listActiveSubs`. Spec: reminder-delivery#Poll cadence (Delivered near schedule). AC: fails first.
- [x] 6.6 GREEN `src/lib/appwrite/reminders.ts` (API-key repo: `listDue` / `markNotified` / `listActiveSubs`).
- [x] 6.7 RED `src/lib/reminders.test.ts`: `runReminderPoll({channel: fake, repo: in-memory, now})` — due fires once to creator only (linked B gets nothing); delivered → marked; transient → unnotified + retried next poll; blocked → `active:false`, `notified` untouched; fresh run over persisted state → no duplicate; disabled → zero sends. Specs: reminder-delivery#Due record fires/#Creator-only delivery/#Marked after success/#Unnotified after failure/#No duplicate after restart/#Transient failure retried; notification-channels#Seam proven with a fake channel; record-visibility#Notification isolation (Only creator notified); telegram-linking#Deactivated subscription on block (Blocked bot deactivates). AC: fails first, no network/credentials.
- [x] 6.8 GREEN `runReminderPoll` in `src/lib/reminder-runner.ts` tick (sequential per-record, mark immediately after each send).
- [x] 6.9 RED source-scan tests (`readFileSync`, literal-sync precedent): `src/lib/reminders.ts` + scheduler import no `telegram` symbol; only `reminder-runner.ts`/`telegram-channel.ts` call `.send(`; page/search/calendar untouched. Specs: notification-channels#Scheduler depends only on the interface (No provider coupling) + #Additional channels are additive; record-visibility#Notification isolation (Admin read/Peer view/Search notify no one). AC: fails first; existing suites unchanged.
- [x] 6.10 GREEN scan passes against 6.2–6.8 structure.
- [x] 6.11 CONDITIONAL — split PR6 if apply forecasts > 400 lines: **6a** = 6.1–6.4 + 6.9 (seam/eligibility), base PR5; **6b** = 6.5–6.8 + 6.10 (repo wiring + marking), base 6a. Still one change (8 PRs).
- [x] 6.12 Gates: `npx tsc --noEmit`, `npx vitest run` green.

## Phase 7: PR7 — link-ui-deploy (UI + entry + docs, ~390)

- [x] 7.1 RED `src/lib/telegram-link.test.ts`: `unlink` resets `{chatId, active, token, tokenExpiresAt}` → `''`/`false`; `buildDeepLink` uses `@`-less username, no chat id. Spec: telegram-linking#Link status and unlink (Unlink). AC: fails first.
- [x] 7.2 GREEN `src/actions/telegram.ts`: session-guarded `mintTelegramLink` (returns `{deepLink}`) + `unlinkTelegram`; thin, verified by 4.1/7.1 units + `tsc`. Spec: telegram-linking#Link initiation (Mint link).
- [x] 7.3 RED `src/lib/telegram-view.test.ts`: Spanish copy helpers — linked "Vinculado", unlinked "Sin vincular", blocked re-link prompt, not-configured env message, badge variants. Specs: telegram-linking#Link status and unlink (Status shown), #Deactivated subscription on block. AC: fails first.
- [x] 7.4 GREEN `src/lib/telegram-view.ts` + `src/components/link-status.tsx` + `src/components/telegram-link.tsx` (plain anchor, no client state, chat id never shown/logged).
- [x] 7.5 `src/app/telegram/page.tsx` (RSC, session guard): not-configured (no mint) / unlinked (mint form) / linked (✓ + "Actualizar") / blocked (re-link). Spec: telegram-linking#Link status and unlink (Status shown). Verified by `tsc`/build + smoke.
- [x] 7.6 RED `src/lib/telegram-view.test.ts`: entry label/href always present regardless of link state; query failure → unlinked badge, never throws. Spec: task-listing#Telegram linking entry point (Entry present when unlinked, Entry shows current status). AC: fails first.
- [x] 7.7 GREEN `src/app/page.tsx`: `<Link href="/telegram">Telegram</Link>` beside `Calendario` + status badge (one session query in try/catch). Spec: task-listing#Telegram linking entry point (Open linking page).
- [x] 7.8 Infra (no tests possible — docs): `README.md` — runner behavior, **single-replica hard constraint** (Easypanel `grupo-ecotech-agenda`), env table + `openssl rand -hex 32`, rollback (`REMINDERS_ENABLED=false`), dev/prod `TELEGRAM_*` anti-pattern, scheduled-function fallback; Easypanel steps (3 `TELEGRAM_*` before enable). Spec: reminder-delivery#Disabled or unconfigured reminders.
- [x] 7.9 CONDITIONAL — split PR7 if apply forecasts > 400 lines: **7a** = 7.1–7.7 (UI), base PR6; **7b** = 7.8 (docs), base 7a.
- [x] 7.10 Gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build` green.

## Phase 8: Final verification & rollout (no new code PR)

- [x] 8.1 Full gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build`. AC: 0 type errors, suite green, build OK.
- [x] 8.2 Spec-coverage audit: map all 17 requirements / 34 scenarios → concrete test cases (table in `verify-report.md`); every requirement ≥1 asserting test; proposal Success Criteria demonstrable. AC: no gap.
- [x] 8.3 Isolation guard: `git diff --stat` shows no `crm-ge`/`ecotech_sitio_web` changes; grep `.send(` only in `reminder-runner.ts`/`telegram-channel.ts`; `TELEGRAM_*` never `NEXT_PUBLIC_*`, never logged. AC: all pass.
- [x] 8.4 **BLOCKED UNTIL HUMAN** (bot via @BotFather, in progress): create bot, generate `TELEGRAM_LINK_SECRET`, set `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`/`TELEGRAM_LINK_SECRET` in `.env.local` and Easypanel `grupo-ecotech-agenda`. Not a blocker for phases 1–7 (all work runs token-free with fakes). AC: `loadReminderEnv()` → enabled.
      **DONE 2026-10-05**: bot `@agendaecotechbot` (id 8682588595) by user; `TELEGRAM_LINK_SECRET` generated (`randomBytes(32)` hex); 4 vars set in `.env.local` **and** Easypanel (11 vars, 3 masked); verified in-container via `printenv` (token 46 chars, secret 64 chars, `REMINDERS_ENABLED=true`, `TELEGRAM_CALLBACK_ORIGIN` absent ⇒ loopback default).
- [x] 8.5 **BLOCKED UNTIL HUMAN** (depends 8.4): live end-to-end — push → auto-deploy (single replica verified) → mint → deep link → `/start` → confirmation in chat → status "Vinculado" → expired/reused token rejected → dated+timed record fires exactly one message → `notified=true` → restart → no duplicate → unlink → no sends. AC: proposal Success Criteria met; live ops also reported in `verify-report.md`.
      **DONE 2026-10-05 (live evidence)**: deploy `cmuvq8pg9002a07` done, routes `/telegram` + `/api/telegram/link` present; bot runner confirmed alive (established `:443` connection = `getUpdates` long-poll); mint via server action returned a deep link; human clicked `/start` → **status "Vinculado"**; callback route validated live — **401** with no/incorrect `x-link-secret`, **405** on GET (route reached ⇒ middleware exclusion proven, not a 307); due task created 16:08 Panama (now 16:11) → within one 60 s poll → **`notified=True`** (send-then-mark ⇒ Telegram returned 200); probe deleted by exact id `6ac412a20008ab1e1f26` (204), post-state `total=2` with `prueba 1` + `pagar el agua` intact. **Restart-without-duplicate** and **unlink-no-sends** are proven by unit tests (`reminders.test.ts`, `telegram-link.test.ts`), not replayed live — see `verify-report.md`.
- [x] 8.6 Rollback drill: `REMINDERS_ENABLED=false` stops both loops with app unaffected; PRs revert in reverse (stacked-to-main). AC: documented in README (7.8).
