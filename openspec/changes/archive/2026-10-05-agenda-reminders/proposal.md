# Proposal: agenda-reminders

## Intent

The client consults her notebook with her boss and must be nudged at the right time about her "deberes". Records already carry `date`+`time`, but nothing notifies her. Slice 2 delivers **Telegram** reminders to the record's **creator only**, behind a pluggable channel so WhatsApp Cloud API can be swapped in later as a module change, not a rewrite.

## Scope

### In Scope
- `telegram_subscriptions` collection (userId, chatId, one-time expiring token, expiry, createdAt) + `notified` flag on `tasks`.
- Full token-exchange linking: authenticated action mints token → UI opens `t.me/<bot>?start=<token>` → bot `/start` posts `{token, chatId}` + shared secret → server validates (exists/not expired/not used), stores `chatId`, invalidates token → bot confirms in chat. "Vincular Telegram" UI + link status.
- Bot long-poll runner (`getUpdates`) + reminder poll scheduler inside the always-on Next container (`src/instrumentation.ts`) — poll-based, restart-safe.
- `NotificationChannel` seam; Telegram is the only implementation. Reminders notify ONLY the record creator.
- Eligibility wire-up to existing records; provisioning script; env contract (`.env.example` + Easypanel).

### Out of Scope
WhatsApp Cloud API (seam only), webhook mode, per-record opt-out, lead-time ("10 min before") reminders, recurring reminders, other channels (email/SMS), notification-history UI, admin or peer notifications.

## Capabilities

### New Capabilities
- `telegram-linking`: one-time expiring token exchange, deep link, authenticated bot callback, link status/unlink UI.
- `reminder-delivery`: eligibility rules, poll scheduling, creator-only delivery, `notified` state, send-failure/retry behavior, runner lifecycle.
- `notification-channels`: `NotificationChannel` interface contract; the scheduler MUST depend only on the interface, never on a concrete provider.

### Modified Capabilities
- `task-listing`: entry point to the Telegram linking/status page (mirrors the existing calendar entry point).
- `record-visibility`: notification isolation — a reminder MUST reach only the record's creator; an admin reading another's record MUST NOT notify anyone.

## Approach

**Default (chosen):** long-poll bot + poll scheduler as loops started from Next's `src/instrumentation.ts` — no webhook certificates, no `functions.write`. **Alternative rejected as default:** Appwrite scheduled function (`schedule` on `POST /functions`) — `functions.write` on the API key is unverified; keeping it as a documented fallback only.

- **Eligibility:** creator has an active subscription ∧ `date` and `time` both set ∧ scheduled ≤ now ∧ within a 24h late window ∧ status ∉ {`done`,`cancelled`} ∧ `notified ≠ true`. **Undated records and records without a time (including undated notes) produce no reminder**; dated notes with a time behave like tasks.
- **Clock:** compare wall-clock strings via `Intl` in `America/Panama` (container TZ is UTC; Panama has no DST) — never `new Date('YYYY-MM-DDTHH:mm')`.
- **Cadence:** scheduler every 60s (env-tunable), `getUpdates` long-poll timeout 50s. Mark `notified` only after a successful send; Telegram 403 ("bot blocked") deactivates the subscription and the UI shows "re-link".
- **Linking security:** token = 32 crypto-random bytes (base64url), TTL 10 min, single use; callback `POST /api/telegram/link` requires `x-link-secret` from env; tokens/chatIds never logged.
- **Runner lifecycle:** env-gated singleton (dev HMR safe), loop `try/catch` + backoff; all state in Appwrite → restarts resume cleanly. Single-replica deploy assumed (documented) to avoid duplicate sends.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `scripts/provision-reminders.ts` | New | `telegram_subscriptions` collection, `notified` on `tasks` + backfill, indexes |
| `src/instrumentation.ts` | New | Boots bot + scheduler loops (env-gated) |
| `src/lib/{telegram,telegram-link,reminders,notification-channel}.ts` | New | API client, token exchange, eligibility, `NotificationChannel` seam + tests |
| `src/lib/appwrite/{telegram,reminders}.ts` | New | Data access (injected client) |
| `src/app/api/telegram/link/route.ts`, `src/actions/telegram.ts` | New | Bot callback + token-mint action |
| `src/app/telegram/page.tsx`, `src/components/{telegram-link,link-status}.tsx` | New | Linking UI + status |
| `src/lib/env.ts`, `.env.example`, README, `src/app/page.tsx` | Modified | Notification env vars, entry point, docs |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Token secrecy (link token in URL/chat, bot token in env) | Med | 10-min TTL, single use, crypto-random, secret header on callback, no logging of either token |
| Runner lifecycle/restart (dead loop stops delivery; HMR double-start) | Med | Env-gated singleton, backoff on errors, stateless design, container healthcheck restart |
| Message-delivery failure (blocked bot, stale chatId, API down) | Med | Send-then-mark; 403 → deactivate + "re-link" UI; failed sends retry next poll inside the late window |
| Rate limits | Low | 1 long-poll/50s + 1 query/60s for 2 users; honor 429 Retry-After |
| Clock/timezone (UTC container vs Panama wall clock) | Med | `Intl` wall-clock comparison; no DST in Panama; late window bounds stale fires |
| Duplicate sends if scaled out | Low | Single-replica constraint documented; `notified` claim narrows the window |
| `functions.write` scope unverified | — | Not used; scheduled-function path stays a documented fallback |

## Rollback Plan

Set `REMINDERS_ENABLED=false` (runner off, app unaffected) or revert the chained PRs; drop `telegram_subscriptions` and delete the `notified` attribute. Existing records untouched; never touch `crm-ge`/`ecotech_sitio_web`.

## Dependencies

- **Human setup:** bot created via @BotFather (in progress); `TELEGRAM_BOT_TOKEN` + generated `TELEGRAM_LINK_SECRET` supplied as env vars (`.env.local` + Easypanel).
- Appwrite 1.8.1 DB scopes (confirmed); existing session/API-key clients, `tasks` `date_time` index; Node 26 fetch.

## Success Criteria

- [ ] Token flow links a chat: expired/reused tokens rejected; bot confirms in chat; status page shows linked/unlinked.
- [ ] A dated+timed record fires one Telegram message to its creator at (or within one poll of) schedule time; `notified` set; no repeat after a container restart.
- [ ] Undated/no-time records never notify; peers/admins never receive another user's reminder.
- [ ] Scheduler passes a unit test against a fake channel only (seam proven).
- [ ] App boots with reminders disabled when Telegram env vars are absent.

## Proposal question round (open assumptions)

1. Linking is the opt-in: once linked, ALL the user's eligible records remind (no per-record toggle yet) — confirm?
2. `done`/`cancelled` records are skipped; late fire window = 24h — acceptable?
3. Reminder at scheduled time (no early lead time) — acceptable for slice 2?
4. Re-link is manual after "bot blocked" (no email fallback) — acceptable?

## Preflight

Read `config.yaml` (hybrid mode, 400-line budget, proposal rules), both archived changes (proposal + design), all 8 main specs, repo layout. `openspec/project.md` does not exist in the repo (only `config.yaml`) — noted, no blocker. Confirmed constraints taken as given: Appwrite 1.8.1 scopes, `functions.write` unverified, HEAD `8669590`, no `src/instrumentation.ts` yet, `scripts/provision-notebook.ts` as provisioning precedent, `env.ts` load-fails-fast pattern. No blockers.

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
400-line budget risk: High

Estimated ~1,800–2,600 lines including tests — well over one 400-line PR. **Single SDD change, delivered as chained PRs:** `reminders-schema` → `telegram-linking` → `bot-runner` → `reminder-scheduler` → `link-status-deploy`. Split into two changes was rejected: linking and delivery share one risk surface (Telegram), one env contract, and one provisioning run; PR chaining already protects the review budget. Strategy: auto-forecast.
