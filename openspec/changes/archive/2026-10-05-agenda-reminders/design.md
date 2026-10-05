# Design: agenda-reminders (slice 2)

## Technical Approach

Two long-lived loops — bot `getUpdates` long-poll + reminder poll — boot from Next 15's stable `src/instrumentation.ts` inside the single always-on container; all state lives in Appwrite (`telegram_subscriptions`, `tasks.notified`) so restarts resume cleanly. Linking is a 10-min single-use token exchanged through a secret-header route; the scheduler depends only on a `NotificationChannel` interface (Telegram = sole implementation). Time is compared as Panama wall-clock strings, never `Date` parsing. Maps specs: `reminder-delivery` → D1/D2/D5, `telegram-linking` → D3/D4/D8, `notification-channels` → D6, `record-visibility` → D5/D7, `task-listing` → D8. Zero new dependencies (node:crypto, `Intl`, `fetch`). `instrumentation` is stable since Next 15 (no config flag; repo has 15.5.27).

## Architecture Decisions

### D1 — Runner lifecycle: env-gated `globalThis` singleton, fire-and-forget loops

| Option | Tradeoff | Decision |
|---|---|---|
| Appwrite scheduled function | No container loop, but `functions.write` unverified | Rejected as default — documented fallback only |
| `setInterval` in instrumentation | Tick > interval ⇒ overlapping polls ⇒ duplicate-send window | Rejected |
| Await loops inside `register()` | `register()` must complete before serving ⇒ boot hangs | Rejected |
| Module-scope `let started` guard | HMR re-evaluates modules ⇒ flag resets ⇒ double start | Rejected |
| Recursive `setTimeout` + `globalThis[Symbol.for(…)]` + backoff | Non-overlapping by construction; identity survives re-import; errors contained | **Chosen** |

Exact mechanism:
- `src/instrumentation.ts`: `export async function register()` → return unless `NEXT_RUNTIME === 'nodejs'` → `try { bootRunners() } catch { console.error }`. Loops are started with `void`, never awaited; `register()` itself can never fail boot.
- `bootRunners()` checks `globalThis[Symbol.for('agenda.reminders.runner')]` first: present → return (idempotent under dev HMR; `Symbol.for` is identity-stable across re-evaluations). The stored record `{ running: boolean, stop(): void }` also powers SIGTERM and tests.
- Env gate via non-throwing `loadReminderEnv()` (D9). Disabled → set guard, log one line (`reminders disabled: <reason>`), return — **app boots with zero Telegram env** (spec `Disabled or unconfigured reminders`).
- Loop body: `while (rec.running) { try { await tick(); failures = 0 } catch (e) { failures++; log(method+status only); await sleep(min(interval * 2**failures, 300_000)) } await sleep(interval) }` — backoff resets on success; a throw never escapes, so the server process never crashes from a loop.
- Timers: inter-tick sleeps are `setTimeout(…).unref()` (a pending sleep never delays process exit; the HTTP server owns process lifetime), plus `SIGTERM → rec.running = false; clearTimeout(sleep); abort in-flight getUpdates via AbortController` — prompt container exit instead of Docker's 10 s SIGKILL. Offset for `getUpdates` is in-memory only: re-delivered `/start`s are idempotent (D4), reminders don't flow through the bot loop, so no external offset state is needed.

| Context | Behavior |
|---|---|
| prod, env present | both loops start exactly once; **Easypanel single replica** (stated in README — a second replica double-sends; Telegram's 409 on concurrent `getUpdates` protects only the bot loop, never the scheduler) |
| env absent / `REMINDERS_ENABLED=false` | guard set, one log line, zero timers, app fully functional |
| dev HMR re-import | `globalThis` guard returns — no second loop |
| transient error | caught, backoff ≤ 300 s, server unaffected |
| dev `.env.local` with Telegram keys while prod runs | **documented anti-pattern** — both containers poll; never enable locally |

### D2 — Time: Panama wall-clock string compare; indexed narrow + pure decide

- `panamaWallClock(nowMs)` = `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Panama', year/month/day/hour/minute 2-digit, hourCycle: 'h23' })` + `formatToParts` → fixed-width `YYYY-MM-DDTHH:mm` (`h23` avoids the ICU `24:00` midnight gotcha).
- `scheduled = date + 'T' + time` (both already Panama wall clock, zero-padded) ⇒ lexicographic compare IS chronological.
- Late window: `windowStart = wallClock − 1440 min`, computed by parsing `nowWall + ':00Z'` as a UTC `Date`, subtracting `86_400_000`, formatting back — safe because Panama (UTC−5) has no DST, so wall-clock arithmetic ≡ real arithmetic.
- **Eligibility query** (narrowing only, rides existing `date_time` index): `[Query.equal('status', ['open','in_progress']), Query.between('date', windowStart.slice(0,10), nowWall.slice(0,10)), Query.orderAsc('date'), Query.orderAsc('time'), Query.limit(100)]` via the API-key client. `Query.equal` with an array is confirmed supported in node-appwrite 19.
- **Pure decide** (`src/lib/reminders.ts`, zero I/O): `isEligible(rec, nowWall, linkedCreators)` = `date !== '' && time !== ''` ∧ `status ∉ {done,cancelled}` ∧ `linkedCreators.has(createdBy)` ∧ `notified !== true` ∧ `windowStart ≤ scheduled ≤ nowWall`. Day bounds in the query are inclusive; the pure function does exact minute bounds. `notified` is filtered in memory (candidate set = one day of records for a handful of users) — avoids depending on how Appwrite compares `null`.
- Rejected: `new Date('YYYY-MM-DDTHH:mm')` (container TZ = UTC / engine-dependent ⇒ 5 h skew); mutating `process.env.TZ` (global side effects); computed-time query filters (unindexable).

### D3 — Telegram client: injectable transport, redacted logging, 429/403 mapping

- `src/lib/telegram.ts`: `createTelegramApi({ token, transport })` → `getUpdates({ offset, timeoutSeconds: 50, signal })`, `sendMessage(chatId, text, signal)`.
- `Transport.call(method, body, { timeoutMs }) → { status, payload }` — default builds `https://api.telegram.org/bot<token>/<method>` with `fetch` + `AbortSignal.timeout`. Tests inject a fake transport: **no network, no credentials** (Node 26 local fetch bug only affects node-appwrite's dispatcher; raw fetch is fine; prod runs Node 22 + `FORCE_NODE_FETCH=1`).
- Outcomes: `200 ok` → delivered; `403` → `blocked`; `429` → `transient` with `retryAfterMs = payload.parameters.retry_after * 1000` (bot loop sleeps that long before retrying a confirmation; scheduler treats as transient — next poll ≥ retry-after); network error / 5xx → `transient`.
- **Logging contract**: client throws `TelegramCallError { method, status }` only — never the URL (it contains the token), never chat ids, never `/start` payloads or message text. Logs are counts + method + status. Asserted by unit test (error message must not contain the token/chat id).

### D4 — Token exchange: mint → deep link → secret-header callback → consume (idempotent)

- **Mint** (`mintTelegramLink` server action, session-guarded): `crypto.randomBytes(32).toString('base64url')` (256-bit), `tokenExpiresAt = now + 10 min` (ISO UTC); upsert into the caller's subscription doc (re-mint overwrites ⇒ old deep links die).
- **Deep link**: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}` (`@`-less username from env).
- **Callback** `POST /api/telegram/link` — the middleware presence gate MUST NOT swallow it (it has no `aw_session` cookie): add `api/telegram/link` to `MIDDLEWARE_MATCHER`'s exclusion (exact F1/upload precedent) in `src/lib/middleware-matcher.ts` AND the inlined literal in `src/middleware.ts`, extending the literal-sync test.
- Route auth: header `x-link-secret` vs env, `crypto.timingSafeEqual` on length-guarded buffers (length mismatch → reject before comparing) → `401` without touching storage.
- Domain `exchangeLinkToken({ token, chatId })`: find by `token` (key index, `limit 1`) → require `token !== ''` ∧ `now < tokenExpiresAt` → single-document update `{ chatId, active: true, token: '', tokenExpiresAt: '' }` (consumption = invalidation) → bot sends confirmation (`"Vinculación correcta. Ya recibirás tus recordatorios aquí."`). Unknown/expired/used → uniform `404` (no oracle). **Idempotence**: if the incoming `chatId` already matches an active link, return `already-linked` success without consuming anything — makes crash-redelivery of `/start` safe.
- Bot loop on `/start <token>`: POST this route with the secret (self-POST via `TELEGRAM_CALLBACK_ORIGIN`, default `http://127.0.0.1:3000` — single container, loopback works); offset advances only after a terminal outcome; transient failures keep the offset so Telegram re-delivers.
- Rejected: separate one-shot `link_tokens` collection (extra schema, no real atomicity without transactions — one doc per user is already the concurrency unit); JWT state param (reinvented storage); in-process-only exchange (would leave the spec's secret-header callback unexercised and kill the documented scheduled-function fallback).

### D5 — `notified`: send-then-mark, layered exactly-once, accepted ms-window

| Option | Tradeoff | Decision |
|---|---|---|
| Claim-then-send (`notified='pending'`) | Needs enum + claim-expiry GC; crash after claim **loses** the reminder — worse per spec ("no lost due records") | Rejected |
| Send-then-mark | Crash between send and mark ⇒ rare duplicate | **Chosen** |

Layers against duplicates: (1) **single replica** — hard deployment constraint, stated in design/README/Easypanel (scheduler has NO protocol-level protection like the bot's 409); (2) recursive `setTimeout` ⇒ polls never overlap; (3) sequential per-record processing with the mark immediately after each send (never batched); (4) `notified` persisted externally ⇒ restart-safe. `tasks.notified` is written ONLY by the scheduler and ONLY after `delivered`; `transient`/`blocked` leave it untouched (`blocked` instead deactivates the subscription, removing eligibility — spec `Deactivated subscription on block`).

### D6 — `NotificationChannel` seam: interface + outcome union, scheduler takes the interface

```ts
// src/lib/notification-channel.ts — the ONLY contract the scheduler imports (type-only)
export type ChannelOutcome =
  | { status: 'delivered' }
  | { status: 'transient'; retryAfterMs?: number }
  | { status: 'blocked' };
export interface NotificationChannel {
  readonly id: string;
  send(target: string, text: string): Promise<ChannelOutcome>;
}
// src/lib/telegram-channel.ts — createTelegramChannel(api): NotificationChannel
//   200 → delivered · 403 → blocked · 429/5xx/network → transient
```
`runReminderPoll({ channel, repo, now })` has no provider symbol in its module (enforced by a source-scan unit test — the project already uses literal-sync tests as precedent). A fake channel recording `(target, text)` pairs satisfies `Seam proven with a fake channel` / `No provider coupling` with zero network. WhatsApp later = new file implementing the interface + config selection; eligibility untouched (`Additional channels are additive`). Rejected: bare `send(msg)` callback (spec demands a named contract), abstract base class (TS interface suffices).

### D7 — Schema & provisioning (all additive, idempotent, probe-guarded)

`agenda.telegram_subscriptions` (new; perms mirror `tasks`: collection `create("users") + read("team:admins")`, `documentSecurity:true`, doc `read/write("user:<uid>")`):

| attr | type | req | default | notes |
|---|---|---|---|---|
| `userId` | string 36 | yes | – | subscription owner |
| `chatId` | string 40 | no | `''` | `''` = unlinked |
| `active` | boolean | no | `false` | true after exchange; false after unlink / 403-block |
| `token` | string 64 | no | `''` | consumed → `''` |
| `tokenExpiresAt` | string 30 | no | `''` | ISO UTC |

Indexes: `user_id` **unique**(`userId`) — one doc per user; `token` key(`token`) — lookups never filter on `''` (exact match on the 43-char random value).
`agenda.tasks` (existing): + `notified` boolean, `required:false`, `default:false`. **Probe**: if 1.8.1 rejects `default` on create, retry without it — the read path treats anything `!== true` as unnotified, so null-backfilled existing rows are correct by construction; **no data backfill, no new index** (day-window rides `date_time`).
Client split: session client for mint/status/unlink (Appwrite enforces ownership); **API-key client for callback exchange, active-subscription listing, eligibility reads and `notified` writes** — the scheduler runs as the system, never as a viewer (keeps `record-visibility`: human reads/searches/calendar produce zero sends because only the loop module ever calls `channel.send`).
`scripts/provision-reminders.ts`: raw-fetch idempotent precedent (`provision-notebook.ts`) — GET-state-then-create, wait-for-`available`, steps: collection → 5 attrs → 2 indexes → `tasks.notified` probe (with/without default). Re-run = no-op. Run once (API key, `.env.local`) when PR1 applies. Never touches `crm-ge`/`ecotech_sitio_web`.

### D8 — UI: `/telegram` status page + list entry point, SSR-only

- `/telegram/page.tsx` (RSC): session guard (`getCurrentUser`/redirect pattern), loads own subscription via session client (`Query.equal('userId', uid)`). States: **not-configured** (env disabled — copy says so, no mint), **unlinked** (mint form → server action returns `{ deepLink }` for a plain anchor — no client state, mirrors existing forms), **linked** (status ✓ + "Actualizar" reload link — no polling), **blocked** (re-link prompt, spec `Deactivated subscription on block`). Unlink = server action → `{ chatId:'', active:false, token:'', tokenExpiresAt:'' }`.
- Entry point (`task-listing` delta): `src/app/page.tsx` header gains `<Link href="/telegram">Telegram</Link>` beside `Calendario` (identical border style), **always rendered** regardless of link state, with a status badge fed by one session-client query wrapped in try/catch (failure → unlinked badge, never breaks the list).
- Components `src/components/telegram-link.tsx` + `link-status.tsx`. Chat ids are never displayed (nor logged). Browser never touches Appwrite; no `TELEGRAM_*` value is `NEXT_PUBLIC_*`.

## Data Flow

```
LINKING                                REMINDER POLL (loop B, every 60 s)
Browser ──server action mint──▶ Next   register() ──▶ bootRunners() [globalThis guard]
  ◀── deep link t.me/<bot>?start=… ──  │  ├─ loop A (bot): getUpdates(timeout 50s)
User ──/start <token>──▶ Telegram       │  │    /start <token> ──POST /api/telegram/link
  ◀──getUpdates── loop A                │  │      x-link-secret ─ timingSafeEqual ─▶ 401?
  loop A ──POST {token,chatId}──▶ route │  │      exchangeLinkToken ─ find by token ─▶ 404?
    (secret header; no session cookie)  │  │      ok ─ update {chatId,active,token:''} ─▶ 200
      ok ◀── 200 ── store               │  │      loop A ──sendMessage confirm──▶ chat
      loop A ──sendMessage confirm──▶   │  └─ loop B: active subs → creators{uid→chatId}
Browser /telegram reload ─▶ "linked"    │       tasks: status∈{open,in_progress}
                                        │         ∧ date∈[now−24h, now]  (date_time idx)
                                        │       isEligible(rec, panamaWallClock(now)) pure
                                        │       sequential: channel.send(chatId, "Recordatorio: …")
                                        │         delivered → update notified:true
                                        │         transient → untouched (retry next poll)
                                        │         blocked   → active=false (re-link UI)
                                        └─ error → backoff min(60s·2^n, 300s), never exits
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/instrumentation.ts` | Create | `register()`: nodejs guard → `bootRunners()` (fire-and-forget, never throws) |
| `src/lib/reminder-runner.ts` | Create | globalThis guard, both loops, backoff, SIGTERM/abort, env gate (+test) |
| `src/lib/telegram.ts` | Create | transport + `getUpdates`/`sendMessage`, outcome mapping, redacted errors (+test) |
| `src/lib/telegram-link.ts` | Create | mint/deep-link/exchange domain, TTL + idempotence (+test) |
| `src/lib/notification-channel.ts`, `src/lib/telegram-channel.ts` | Create | seam contract; Telegram implementation (+tests) |
| `src/lib/reminders.ts`, `src/lib/appwrite/reminders.ts` | Create | pure `isEligible`/wall-clock/window; due-query + mark-notified repo (+tests) |
| `src/lib/appwrite/telegram.ts` | Create | subscriptions data access, injected client (+tests) |
| `src/app/api/telegram/link/route.ts` | Create | secret-header callback → domain (+test: 401/404/200) |
| `src/actions/telegram.ts` | Create | `mintTelegramLink`, `unlinkTelegram` (thin, session-guarded) |
| `src/app/telegram/page.tsx`, `src/components/{telegram-link,link-status}.tsx` | Create | status/link UI (RSC + actions, Spanish copy) |
| `scripts/provision-reminders.ts` | Create | idempotent collection/attrs/indexes/`notified` probe |
| `src/lib/env.ts` (+`env.test.ts`), `.env.example`, `README.md` | Modify | non-throwing `loadReminderEnv()`, env keys, runner/single-replica docs |
| `src/lib/middleware-matcher.ts`, `src/middleware.ts` (+sync test) | Modify | exclude `api/telegram/link` (F1 precedent) |
| `src/app/page.tsx` | Modify | header entry point + status badge |

## Interfaces / Contracts

```ts
type ReminderEnv = { enabled: false; reason: string }
  | { enabled: true; botToken: string; botUsername: string; linkSecret: string;
      callbackOrigin: string; pollSeconds: number };          // never throws
// reminders.ts (pure): isEligible(rec, nowWall, linked) · panamaWallClock(ms) · windowStart(nowWall)
// runner: bootRunners(deps?) → starts ≤1 record on globalThis[Symbol.for('agenda.reminders.runner')]
// repo seam (appwrite/reminders.ts): listDue(windowStart, nowWall) · markNotified(id) · listActiveSubs()
```

## Env Contract (all OPTIONAL — absence disables, app still boots; NOT in `SERVER_ENV_KEYS`)

| Key | Default | Used by | Easypanel |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | – (absent ⇒ disabled) | both loops | set (secret) |
| `TELEGRAM_BOT_USERNAME` | – (absent ⇒ disabled) | deep link | set |
| `TELEGRAM_LINK_SECRET` | – (absent ⇒ disabled) | callback + bot POST | set (`openssl rand -hex 32`) |
| `REMINDERS_ENABLED` | `true` | master switch | `false` = instant rollback |
| `REMINDERS_POLL_SECONDS` | `60` | loop B | optional |
| `TELEGRAM_CALLBACK_ORIGIN` | `http://127.0.0.1:3000` | loop A self-POST | default (port must match) |

Gate = all three `TELEGRAM_*` present ∧ `REMINDERS_ENABLED !== 'false'`. Added to `.env.example` + README; set on service `grupo-ecotech-agenda` (vars 1–3 before stage E goes live).

## Testing Strategy (unit-first; Vitest node, fake/injected everything — no network, no credentials)

| Capability | What | Approach |
|---|---|---|
| `reminder-delivery` | all 7 spec scenarios: due fires, missing date/time, terminal status, 24 h window, mark-after-success, unnotified-after-failure, restart-no-dup, creator-only | `reminders.test.ts`: table-driven `isEligible` (fixed `nowWall` string, no clock) + `runReminderPoll` with **fake channel** + in-memory repo + injected `now` |
| time (D2) | midnight `h23`, window arithmetic, no-DST invariant | fixed-epoch unit tests of `panamaWallClock`/`windowStart` |
| poll cadence | query shape | fake `Databases` asserting exact `Query.equal/between/orderAsc/limit` JSON (existing fake-client pattern) |
| `notification-channels` | delivered/blocked/transient(+429 retryAfter) mapping; **no provider coupling** | `telegram-channel.test.ts` with fake transport; source-scan test: `reminders.ts`/scheduler import no `telegram` symbol (literal-sync precedent) |
| `telegram-linking` | mint TTL, expired/reused token, missing/wrong secret → 401, uniform 404, idempotent re-`/start`, unlink | domain tests with fake repo + fake clock; route test (401/404/200) with mocked domain; no logging of token/chatId asserted |
| runner lifecycle (D1) | double-boot → 1 start; disabled env → 0 loops; backoff growth/reset; SIGTERM stops | `vi.useFakeTimers`, reset `globalThis` guard between tests |
| `task-listing` | entry present unlinked/linked | `page.tsx` covered by build + smoke (project convention); badge helper unit |
| `record-visibility` | viewing/listing/search never sends | static scan: only `reminder-runner.ts` calls `channel.send`; existing suites unchanged |
| gates | `npx tsc --noEmit` 0 · `npm test` green · `npm run build` OK | per-PR (repo standard) |

## Migration / Rollout

Additive only; existing documents untouched. Order: PR1 apply → run `scripts/provision-reminders.ts` once (API key) → merge chain → set Easypanel `TELEGRAM_*` → enable last. **Rollback**: `REMINDERS_ENABLED=false` (runner off, app unaffected) → revert PRs in reverse (stacked-to-main: each revert is one PR) → optionally drop `telegram_subscriptions` + delete `tasks.notified`. Never touch `crm-ge`/`ecotech_sitio_web`.

## PR Chain Plan — strategy `stacked-to-main` (each PR < 400 lines, green, revert = revert that PR; stages = proposal names)

| Stage | PR | Contents | Est. |
|---|---|---|---|
| A `reminders-schema` | 1 `reminders-schema` | `provision-reminders.ts` (~290), `loadReminderEnv` + tests (~70), `.env.example` | ~370 |
| A | 2 `subscription-data` | `appwrite/telegram.ts` + tests | ~320 |
| B `telegram-linking` | 3 `telegram-client` | `telegram.ts` (transport, getUpdates/sendMessage, 429/403) + tests | ~340 |
| B | 4 `linking` | `telegram-link.ts` domain + tests, callback route + matcher exclusion + sync test | ~390 |
| C `bot-runner` | 5 `bot-runner` | `instrumentation.ts`, `reminder-runner.ts` (guard/loops/backoff/SIGTERM) + tests | ~390 |
| D `reminder-scheduler` | 6 `scheduler` | channel seam + `telegram-channel`, `reminders.ts`, `appwrite/reminders.ts`, notified marking + tests | ~395 |
| E `link-status-deploy` | 7 `link-ui-deploy` | actions, `/telegram` page + components, home entry, README/env/Easypanel docs | ~390 |

Total ≈ 2,500 (proposal range 1,800–2,600). Contingency: if apply's forecast flags PR6/PR7 > 400, split 6→6a eligibility+fake-channel tests / 6b wiring+marking, 7→7a UI / 7b docs (8 PRs, still one change).
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## Risks & Rollback

| Risk | Mitigation |
|---|---|
| Replica > 1 ⇒ double sends | Single replica stated as hard constraint (README + Easypanel); bot loop additionally protected by Telegram 409, scheduler by nothing |
| Dev + prod both enabled | `.env.local` keeps `TELEGRAM_*` empty; documented anti-pattern |
| `/api/telegram/link` swallowed by middleware | Matcher exclusion + literal-sync test (F1 precedent); route self-auths via secret |
| `TELEGRAM_CALLBACK_ORIGIN` port mismatch ⇒ confirmations fail | Default 3000, env override; failure is visible in bot chat (retry mint), reminders unaffected |
| `notified` default-backfill unverified on 1.8.1 | Probe with/without `default`; read path accepts `null` (`!== true`) |
| Crash between send and mark | Accepted ms-window duplicate; claim-then-send rejected (can lose reminders) |
| Token/chatId/bot-token leak | Logging contract (method+status only) + tests; secret header timing-safe compare |
| Local Node 26 vs prod Node 22 | Tests use fake transport only; raw fetch unaffected by the node-appwrite bug; prod keeps `FORCE_NODE_FETCH=1` |

## Open Questions

- [ ] Proposal Q1–Q4 (opt-in = linking all records; `done`/`cancelled` skip + 24 h window; no lead time; manual re-link) — specs carry them as pending assumptions; confirm to lock.
- [ ] Self-POST default origin: derive from `PORT` when set, or keep fixed `http://127.0.0.1:3000`? (default: fixed, overridable)
- [ ] Show a masked chat id on the linked status page, or only "Vinculado ✓"? (default: only ✓)
