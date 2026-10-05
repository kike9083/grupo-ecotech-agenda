# Apply Progress: agenda-reminders (slice 2)

**Scope of this run**: Phases 1–4 (PR1–PR4). Phases 5–8 intentionally untouched.
**Mode**: Strict TDD (`strict_tdd: true` from tasks.md — `openspec/config.yaml` still says `false` because it predates the Vitest install; orchestrator mandated strict TDD).
**Artifact store**: hybrid — `openspec/changes/agenda-reminders/tasks.md` (`[x]` marks) + Engram `sdd/agenda-reminders/apply-progress`.
**Chain strategy**: stacked-to-main, one commit per PR, no push.
**Safety net baseline**: 327 tests / 25 files green, `npx tsc --noEmit` clean (captured before first edit).

## Phase 1 — PR1 reminders-schema — DONE

| Task | Status | Evidence |
|---|---|---|
| 1.1 RED `loadReminderEnv` tests | [x] | 7 new tests written first; **6 failed** with `TypeError: loadReminderEnv is not a function`, 6 passed (5 pre-existing + 1 guard that never calls it) — RED confirmed by execution |
| 1.2 GREEN `loadReminderEnv` | [x] | `src/lib/env.ts` — `ReminderEnv` union, defaults `pollSeconds: 60`, `callbackOrigin: http://127.0.0.1:3000`, never throws; `loadEnv` untouched; 12/12 in `env.test.ts` |
| 1.3 Provisioning script | [x] | `scripts/provision-reminders.ts` — GET-state-then-create, wait-`available`, create-only (zero delete/update calls), `provision-notebook.ts` precedent |
| 1.4 `tasks.notified` probe | [x] | Appwrite 1.8.1 ACCEPTED `default:false` on create (no fallback needed). Legacy rows read `notified: null` → `!== true` ⇒ unnotified, correct by construction; no backfill, no index, no document write |
| 1.5 Run once | [x] | Ran 3× against live `agenda`: run 1 created collection+`userId`+`chatId` then hit a boolean-attr endpoint bug (fixed); run 2 completed the rest; run 3 = **0/9 applied (all SKIP)** — idempotence proven |
| 1.6 `.env.example` | [x] | 6 optional keys added, none `NEXT_PUBLIC_*`, gated comment |
| 1.7 Gates | [x] | `tsc --noEmit` 0 errors · `vitest run` **334/334** · `next build` OK |

**Live safety check (read-only)**: `agenda.tasks` still returns exactly the 2 pre-existing rows (`prueba 1`, `pagar el agua`) with `notified: null`; `telegram_subscriptions` has 0 documents. `crm-ge` / `ecotech_sitio_web` never addressed (script only builds URLs from `APPWRITE_DATABASE_ID=agenda`).

**Objects created in this run (IDs created here, safe to delete on rollback)**:
- collection `agenda.telegram_subscriptions` — 5 attrs (`userId`, `chatId`, `active`, `token`, `tokenExpiresAt`), 2 indexes (`user_id` unique, `token` key)
- attribute `agenda.tasks.notified` (boolean, required:false, default:false)

### TDD Cycle Evidence — Phase 1
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `src/lib/env.test.ts` | Unit | ✅ 327/327 baseline | ✅ Written (6/7 new tests failed) | ✅ 12/12 passed | ✅ 7 cases (defaults, overrides, invalid poll ×5, missing key ×3 shapes, explicit disable, never-throws) | ➖ None needed |
| 1.3 | — | Infra | N/A | — | — | — | Task marked "no tests possible" (live provisioning) |
| 1.4 | — | Infra | N/A | — | — | — | Probe + live verification instead of unit test |
| 1.6 | — | Infra | N/A | — | — | — | Doc file only |

## Phase 2 — PR2 subscription-data — DONE

| Task | Status | Evidence |
|---|---|---|
| 2.1 RED `telegram.test.ts` | [x] | Written before the module existed — `Cannot find module './telegram'` ⇒ **0 tests collected** (RED by execution) |
| 2.2 GREEN `appwrite/telegram.ts` | [x] | Injected `Databases` + config; `upsertSubscription` (create carries `Permission.read/write(Role.user(uid))`), `getByUser`, `findByToken` (empty token short-circuits), `listActiveSubs` (`cursorAfter` paging), `link`/`deactivate`/`unlink`; **14/14** |
| 2.3 Gates | [x] | `tsc --noEmit` 0 errors · `vitest run` **348/348** · `next build` OK |

### TDD Cycle Evidence — Phase 2
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `src/lib/appwrite/telegram.test.ts` | Unit (fake `Databases`) | ✅ 334/334 after PR1 | ✅ Module unresolved ⇒ 0 collected | ✅ 14/14 | ✅ Pagination test proven meaningful by mutation: collapsing the cursor loop to a single page makes it fail | ➖ None needed |

## Phase 3 — PR3 telegram-client — DONE

| Task | Status | Evidence |
|---|---|---|
| 3.1 RED `src/lib/telegram.test.ts` | [x] | Fake `Transport` first — module unresolved ⇒ **0 tests collected**; then **11/11** green on the first implementation |
| 3.2 GREEN `src/lib/telegram.ts` | [x] | `createTelegramApi({token, transport})`, `getUpdates` throws `TelegramCallError{method,status}` (status `0` = no HTTP response), `sendMessage` never throws (200→`delivered`, 403→`blocked`, 429→`transient`+`retryAfterMs`, else `transient`); default `createFetchTransport` + `AbortSignal.timeout(50_000)`; **14/14** |
| 3.3 Gates | [x] | `tsc --noEmit` 0 errors · `vitest run` **362/362** · `next build` OK |

### TDD Cycle Evidence — Phase 3
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1/3.2 | `src/lib/telegram.test.ts` | Unit (fake transport, zero network/credentials) | ✅ 348/348 after PR2 | ✅ Module unresolved ⇒ 0 collected (11 tests) | ✅ 11/11, later **14/14** | ✅ Default-transport trio (URL/body/signal, rejected fetch → status 0, non-JSON body → null payload) was added **after** the first GREEN — so it was proven meaningful by mutation instead: hard-coding the URL to `botSTUB/getUpdates` makes the URL assertion fail (1 failed), restoring it returns 14/14 | ➖ None needed |

## Phase 4 — PR4 linking (domain + route + matcher) — DONE

| Task | Status | Evidence |
|---|---|---|
| 4.1 RED `src/lib/telegram-link.test.ts` | [x] | Fake repo + injected clock written first — `Cannot find module './telegram-link'` ⇒ **0 tests collected** |
| 4.2 GREEN `src/lib/telegram-link.ts` | [x] | `generateLinkToken` = `randomBytes(32).toString('base64url')` (43 chars), `mintTelegramLink` (10-min ISO TTL, re-mint overwrites), `buildDeepLink`, `exchangeLinkToken` (`rejected` for unknown/expired/used, `already-linked` without a write, deactivated → `linked`); **16/16** |
| 4.3 RED `route.test.ts` | [x] | Route module absent ⇒ **0 tests collected**; 15 assertions on 401/400/404/200 + no-logging |
| 4.4 GREEN `src/app/api/telegram/link/route.ts` | [x] | Injected-deps core `handleLink(deps, request)` (repo precedent `api/attachments/[fileId]`), length-guarded `timingSafeEqual`, lazy API-key client built **inside** the exchange callback; **15/15** |
| 4.5 RED matcher exclusion | [x] | **1 failed / 6 passed** — only the new `matchesMiddleware('/api/telegram/link') === false` assertion failed; the literal-sync guard stayed green |
| 4.6 GREEN matcher + literal | [x] | `api/telegram/link` added to the negative lookahead in `src/lib/middleware-matcher.ts` **and** the inlined literal in `src/middleware.ts`; **7/7** (literal-sync guard passes) |
| 4.7 Gates | [x] | `tsc --noEmit` 0 errors · `vitest run` **396/396** · `next build` OK |

### TDD Cycle Evidence — Phase 4
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1/4.2 | `src/lib/telegram-link.test.ts` | Unit (fake repo + fake clock) | ✅ 362/362 after PR3 | ✅ Module unresolved ⇒ 0 collected | ✅ 16/16 | ✅ Uniform-rejection oracle test (unknown/expired/used must stringify to one value), empty token never queries, re-mint kills the old deep link | ➖ Narrow seams split by consumer: `TelegramLinkExchangeRepo` (route) / `TelegramLinkMintRepo` (phase 7) |
| 4.3/4.4 | `src/app/api/telegram/link/route.test.ts` | Unit (injected fake domain — no `vi.mock`, no Appwrite client) | ✅ 378/378 | ✅ Route absent ⇒ 0 collected | ✅ 15/15 | ✅ Wrong-length secret must 401 without throwing; numeric chat id coerced; 401/404 bodies must not echo the secret or token | ➖ None needed |
| 4.5/4.6 | `src/lib/middleware-matcher.test.ts` | Unit | ✅ 393/393 | ✅ 1 failed / 6 passed | ✅ 7/7 | ✅ F1-precedent assertions (`/`, `/nota`, `/api/attachments/abc123` stay gated; upload + asset exclusions untouched) | ➖ Literal-sync guard unchanged |

## Deviations & risks (flagged for the orchestrator)

1. **Line budget overrun on every PR so far** (forecast vs actual added lines): PR1 617 (phase forecast ~300), PR2 652 (~320), PR3 496 (~340), PR4 **1,080** (~390). Root cause: the spec demands exhaustive acceptance coverage (34 scenarios across 5 specs) and the repo's test style is one assertion-heavy test per scenario. The prescribed phase→PR mapping was kept rather than re-slicing mid-flight; each PR needs a `size:exception` or a re-slice decision before it goes to review.
2. **`openspec/config.yaml` still says `strict_tdd: false`** while `tasks.md` says `strict_tdd: true` (the config predates the Vitest install). This run followed tasks.md (strict TDD); the config is stale, not a conflict.
3. **`saveToken` (concrete repo method behind `TelegramLinkMintRepo`) is intentionally deferred to phase 7**, where the mint action wires it. Consequence: nothing in production mints tokens yet; the callback route (phase 4) is fully wired end-to-end through `findByToken`/`link`.
4. **3 default-transport tests in PR3 were written after the first GREEN** (see Phase 3 table) — proven meaningful by mutation rather than by a real RED. Everything else in phases 1–4 failed first.
5. **Collection id constant**: `TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID` now lives in `src/lib/appwrite/telegram.ts`, while `scripts/provision-reminders.ts` keeps its own local literal (the script is standalone by design, same as `provision-notebook.ts`). A drift there would need a new provisioning run, not a code fix.

## Status

**Slice 2 (Phases 1–4) complete**: 4 stacked commits on `main`, not pushed.

| PR | SHA | Task | Tests | Gates |
|---|---|---|---|---|
| PR1 reminders-schema | `7313131` | 1.1–1.7 | 327 → 334 | ✅ |
| PR2 subscription-data | `c17d6f5` | 2.1–2.3 | 334 → 348 | ✅ |
| PR3 telegram-client | `e9f2ebb` | 3.1–3.3 | 348 → 362 | ✅ |
| PR4 linking | `fff5b3c` | 4.1–4.7 | 362 → **396** | ✅ |

Baseline: 327 tests / 25 files, tsc clean. Now: **396 tests / 29 files**, tsc clean, `next build` green. Phases 5–8 (bot runner, scheduler, UI, docs) untouched.
