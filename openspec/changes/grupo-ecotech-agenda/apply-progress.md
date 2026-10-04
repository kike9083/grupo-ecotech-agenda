# Apply Progress: grupo-ecotech-agenda

**Phase**: Phase 3 / PR2 — schema-data-layer (current, COMPLETE)
**Mode**: Standard (batch 1) → strict TDD (batch 2 from task 2.2, batch 3 fully)
**Artifact store**: hybrid (OpenSpec file + Engram topic `sdd/grupo-ecotech-agenda/apply-progress`)
**Date**: 2026-10-04
**Batches**: 1 = PR0 Appwrite provisioning (below, complete) · 2 = PR1 scaffold-auth (middle, complete) · 3 = PR2 schema-data-layer (bottom, complete)

## Task Status (cumulative)

- [x] 1.1 git init, first commits, push `main` → kike9083/grupo-ecotech-agenda — done in prior state handoff; AC re-verified this batch via `git ls-remote` (main @ `023ebd8`), working tree clean.
- [x] 1.2 Appwrite REST: DB `agenda`, collection `tasks`, 9 attributes per design D1 — AC met (all 9 `status: available`, exact types/sizes/required).
- [x] 1.3 Appwrite REST: fulltext index `searchText`; key (`date`,`time`) desc,desc — AC met (both `status: available`).
- [x] 1.4 Appwrite REST: team `admins` (owner admin@grupoecotech.com) + first user — membership created `confirm: true`, roles `["owner"]`. Caveat: "REST login works" NOT exercised (no password in scope by instruction); deferred to orchestrator/user.
- [x] 1.5 Fulltext probe (risk #1): seed, search hit, non-hit, delete — AC met; see probe log below. `searchText` size 700 accepted, no shrink needed.
- [x] 1.6 Easypanel `varios` service + env vars + domain — done by orchestrator (MCP, not sub-agent): service `grupo-ecotech-agenda` created; source GitHub `kike9083/grupo-ecotech-agenda@main` (autoDeploy NOT enabled yet — no package.json until PR1, a push now would fail the build); 6 env vars verified present (`APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` (masked), `APPWRITE_DATABASE_ID`, `APPWRITE_TASKS_COLLECTION_ID`, `APPWRITE_ADMINS_TEAM_ID`); domain `varios-grupo-ecotech-agenda.fjueze.easypanel.host` → port 3000, HTTPS on. **PR0 COMPLETE.**

## Resources Provisioned

Endpoint `https://varios-appwrite-techpadah.fjueze.easypanel.host/v1`, project `6a0f609f002105cac0f5`, API key scopes inferred from results (no 401/403 on any call).

| Resource | ID | Create call | Result |
|---|---|---|---|
| Database | `agenda` (name "Agenda") | `POST /databases` | **201** |
| Collection | `tasks` (name "Tasks", `documentSecurity: true`) | `POST /databases/agenda/collections` → `PUT` for documentSecurity | **201** → **200** |
| Team | `admins` (name "Admins") | `POST /teams` | **201** |
| Membership | `6ac1ef35a0e87910569a` → user `6a1030c90014c56a9568` (admin@grupoecotech.com) | `POST /teams/admins/memberships` | **201**, `confirm: true`, roles `["owner"]`, `joined` set (accepted, no pending state) |

Databases `crm-ge` and `ecotech_sitio_web` were only read (`GET /databases`, 200) and NEVER modified.

## Collection Schema — exact match to design D1

All 9 attributes created, final `status: available` (verified `GET .../collections/tasks` → 200):

| attribute | type | size | required | default | status |
|---|---|---|---|---|---|
| `type` | enum `task`\|`request` (`format: enum`) | – | yes | none (server-side default per D1) | available |
| `title` | string | 200 | yes | none | available |
| `description` | string | 2000 | yes | none | available |
| `date` | string | 10 | yes | none | available |
| `time` | string | 5 | yes | none | available |
| `status` | enum `open`\|`in_progress`\|`done`\|`cancelled` | – | yes | none (server writes `open` on create) | available |
| `createdBy` | string | 36 | yes | none | available |
| `createdByEmail` | string | 255 | yes | none | available |
| `searchText` | string | 700 | yes | none | available |

Server-side defaults: Appwrite 1.8 rejects `default` on required attributes (design D1 already requires writes to supply them) — no DB defaults set, as specified.

## Indexes

| key | type | attributes | orders | HTTP | status |
|---|---|---|---|---|---|
| `date_time` | `key` | `date`,`time` | `DESC`,`DESC` | **202** | **available** |
| `search_text` | `fulltext` | `searchText` | – | **202** | **available** |

## Document Permissions Shape (recorded — applies at create-time)

```
$permissions: [ read("user:<creatorUid>"), write("user:<creatorUid>"), read("team:admins") ]
```

Observed Appwrite 1.8 behavior: on `createDocument`, the param name is `permissions` (not `$permissions`), and the stored document showed `write("user:...")` normalized to `update("user:...")` + `delete("user:...")`:

```json
["$permissions":["read(\"user:6a1030c90014c56a9568\")","update(\"user:6a1030c90014c56a9568\")","delete(\"user:6a1030c90014c56a9568\")","read(\"team:admins\")"]]
```

`documentSecurity: true` was set on the collection (design-derived: Appwrite grants access if EITHER document OR collection permission allows; with `documentSecurity: false` document permissions are ignored, which would break D1/D2 record-visibility).

## Live Probe — design risk #1 (fulltext on 700-char `searchText`)

| Step | Call | HTTP | Result |
|---|---|---|---|
| 1 | `POST .../documents` — throwaway doc `probe1`, all 9 attrs, `searchText="probe fulltext"`, permissions shape above | **201** | created, `$permissions` stored |
| 2 | `GET .../documents?queries[]={"method":"search","attribute":"searchText","values":["probe fulltext"]}` | **200** | `total: 1` — probe doc returned (MATCH) |
| 2b | same with value `zzznotfoundzzz` | **200** | `total: 0` (NO false positive) |
| 3 | `DELETE .../documents/probe1` | **204** | deleted |
| 4 | `GET .../documents` | **200** | `total: 0` — collection clean, rollback state confirmed |

**VERDICT: risk #1 RESOLVED** — the instance accepts a `fulltext` index over `searchText` size 700 (index `3_1_search_text` reached `available`), and `search` queries match/discriminate correctly. No size shrink needed.

## API Key Effective Scopes (task 7)

Zero 401/403 responses across every write: databases 201, collections 201/200, attributes 202 ×9, indexes 202 ×2, teams 201, memberships 201/200, documents 201/200/204. Key effectively has `databases.read/write`, `collections.read/write`, `attributes.read/write`, `indexes.read/write`, `teams.read/write`, `documents.read/write` (server key also bypasses document permissions for probes). No scope gaps found.

## HTTP Call Ledger (condensed — every call accounted)

1. `GET /databases` → 200 (2 existing DBs, untouched) · `GET /teams` → 200 (0)
2. `POST /databases` → 201 · `POST /teams` → 201 · `POST /collections` → 201
3. `POST memberships` form `roles=owner` → **400** (array required) · retry `roles[]=owner` → 201
4. Attribute create via form-encoded body (`required=true` / `1` / `false`) → **400 ×7** "Value must be a valid boolean" (strict Boolean validator rejects strings); query-string POST → 400 "Param key is not optional"
5. Attribute create via `Content-Type: application/json` → **202 ×9** (title, type, description, date, time, status, createdBy, createdByEmail, searchText); 8 intermediate JSON attempts with PowerShell-mangled inline bodies → 400 ×8 (client-side quoting issue, no server state change)
6. `GET /collections/tasks` → 200 — all 9 attributes `available`
7. `POST indexes` (`date_time`, `search_text`) → **202 ×2**; `GET` → 200 both `available`
8. `GET /teams/admins/memberships` → 200 (`confirm: true`, owner)
9. `PUT collection` without `name` → 400 "Param name is not optional" · with `name`+`documentSecurity` → **200**
10. Probe attempt A: wrong path (`/collections/tasks`) → 404 ×1 + collection GET ×2 (ignored query, no state change); probe attempt B: top-level doc attrs → 400 `document_missing_data`, old-style query strings → 400 `Invalid query: Syntax error` ×2
11. Final probe: 201 → 200 (total 1) → 200 (total 0) → 204 → 200 (total 0)

## Gotchas for downstream phases (read before coding data layer)

1. **Body format**: attribute/collection/index create accept JSON bodies fine when params are complete — the earlier "form-encoded only" finding applies to routes with strict `Boolean`/`JSON` validators. Form-encoded strings FAIL boolean validation on attribute routes. Use JSON for writes; form works for simple string params (databases/teams/collections).
2. **Arrays in form bodies** need bracket notation: `roles[]=owner` (bare `roles=owner` → 400).
3. **Document create** (1.8): body `{"documentId":"...","data":{...attrs...},"permissions":[...]}` — attributes go inside `data`, permission key is `permissions` (response field `$permissions`).
4. **Queries are JSON strings**, not the legacy `method("arg")` format: `{"method":"search","attribute":"searchText","values":["probe fulltext"]}`; pass repeated `queries[]` (URL form) — wrong format → `400 general_query_invalid "Invalid query: Syntax error"`.
5. **Collection update requires `name`** alongside other fields.
6. **Attribute/index create return 202 `processing`** → poll to `available` before writing documents.
7. **PowerShell 5.1 + curl.exe**: inline JSON args get quote-mangled → write bodies to temp files and use `-d @file` (scripts used: temp `aw.ps1`/`awb.ps1`/`probe.ps1`, not committed, secrets stay out of repo).
8. **Membership accepted immediately** when created server-side with `userId`+`email`+`url` (`confirm: true`) — no invite-secret dance needed.
9. `write(permission)` is stored normalized as `update`+`delete` — data layer should request whatever Appwrite accepts and not assert raw equality on `write(...)`.
10. **Easypanel `set_env_var` read-modify-write is NOT parallel-safe** — parallel calls clobbered each other (3 of 6 vars lost on first attempt); set env vars SERIALLY and verify with `get_env_vars` after.

## Deviations from Design

- `documentSecurity: true` on `tasks` (not an explicit D1 column, but required for D1/D2 permission enforcement; recorded above).
- No other deviations — schema, index types/orders, team/owner, and permissions shape match design D1/D2 exactly.

## Rollback Boundary

Only the new database `agenda` was created/modified → `DELETE /databases/agenda` reverts this entire batch. `crm-ge` and `ecotech_sitio_web` never touched. Teams: only new team `admins` created.

## Batch 2b — first production deploy (orchestrator)

- Enabled `FORCE_NODE_FETCH=1` env (PR1's hard requirement) + GitHub auto-deploy + domain port 3000.
- **Deploy attempt 1 FAILED** (`cmuthy7x3`): Nixpacks used Node 18 (default) → `npm ci` skipped `@tailwindcss/oxide-linux-x64-gnu` (engines node>=20) → `next build` "Cannot find native binding". EBADENGINE warnings confirmed vite/vitest/oxide need Node >=20.
- **Fix**: `.nvmrc` = 22 (commit `c2bc427`) — Nixpacks reads NIXPACKS_NODE_VERSION / engines.node / .nvmrc, default is **18**.
- **Deploy attempt 2 SUCCEEDED** (`cmuti8p5`): build green, container `running`, smoke: `GET /` → **307** `/login`, `GET /login` → **200 Next.js` on `https://varios-grupo-ecotech-agenda.fjueze.easypanel.host`.
- **Live login still gated**: `AGENDA_ADMIN_PASSWORD` in .env.local → 401 `user_invalid_credentials` (account pre-existed with different password). Needs real credentials or a QA user before sdd-verify e2e.
- Gotcha: Easypanel `set_env_var` is read-modify-write — parallel calls clobber (6 parallel → 3 survived). Set env vars serially.

## Next

- Phase 3 / PR2 `schema-data-layer` (strict TDD, mocked client) — independent of the live-login gate.
- sdd-verify will need live login e2e: real admin password or a dedicated QA user.

---

# Batch 2 — Phase 2 / PR1 `scaffold-auth` (COMPLETE)

**Date**: 2026-10-04 · **Tasks**: 2.1–2.5 all `[x]` · **Pushed**: `main @ 0a91333` (origin `kike9083/grupo-ecotech-agenda`), tree clean
**Mode**: strict TDD from task 2.2 onward (RED observed failing → GREEN each task) · 2.1 was bootstrap (pre-runner)
**Review note**: PR1 totals ~3.9k insertions — over the 400-line budget via bootstrap bulk (Next scaffold + env module); recorded per-commit counts below per chained-pr budget rule, no stop-to-ask.

## Task Status (batch 2)

- [x] 2.1 create-next-app@15 scaffold (generated in temp, copied in), `npm install`, build green. AC met.
- [x] 2.2 env module TDD: RED (`Cannot find module './env'`) → GREEN 5/5; missing prod var throws.
- [x] 2.3 clients/session TDD: RED (2 suites failed) → GREEN; `tsc --noEmit` OK.
- [x] 2.4 middleware TDD: RED → GREEN 6/6 (suite grew to 9/9 with expired-flow cases); build green (Middleware 39.2→39.3 kB).
- [x] 2.5 actions TDD: RED (7 failed | 13 passed) → GREEN; login/logout pages glued; AC "cookie set/error/cleared" covered by action units.

## Commits (all pushed)

| commit | subject | +/− |
|---|---|---|
| `7e7ba77` | feat(scaffold): bootstrap Next.js 15 App Router with TypeScript and Tailwind | +2048 / −5 |
| `1273016` | feat(env): add fail-fast server env contract with Vitest setup | +1169 / −21 |
| `c7ef70c` | fix(env): accept injected env sources in loadEnv signature | +3 / −1 |
| `762f135` | feat(auth): add Appwrite server clients and session helpers | +395 / −1 |
| `0c1e47e` | feat(auth): gate protected routes with edge cookie-presence middleware | +84 / −1 |
| `2ea9afb` | fix(deps): pin node-appwrite 19.1.0 with bundled-fetch workaround | +15 / −35 |
| `0a91333` | feat(auth): add login/logout server actions and login page | +364 / −102 |

## Verification evidence

- `npx tsc --noEmit` OK · `npx vitest run` = **4 files, 37/37 passed** · `npm run build` green (`/` + `/login` dynamic ƒ, Middleware 39.3 kB).
- Runtime smoke (`next start`): anon `/` → **307 `/login`** · stale cookie `/` → **307 `/login?error=expired`** · `/login?error=expired` + cookie → **200 + `set-cookie: aw_session=; Expires=1970`** (cleared, no loop) · `/login` anon → **200** with form. No SDK version warning in server log (format 1.8.0 ↔ server 1.8.1).

## Discoveries (batch 2 — read before PR2+)

1. **RSC cannot mutate cookies**: `cookies().delete()` in `getCurrentUser` throws at render ("Cookies can only be modified in a Server Action or Route Handler"). Resolution (Solution B): Home redirects null-user → `/login?error=expired`; middleware clears `aw_session` when `isLoginRoute && error=expired && hasSession` (presence-only, before the existing /login+cookie→/ bounce); `getCurrentUser`'s `onSessionInvalid` wraps clear in try/catch as fallback. Unit tests assert `aw_session=;` + `Expires=Thu, 01 Jan 1970` (Next deletes via epoch Expires, NOT `Max-Age=0`).
2. **node-appwrite ↔ server 1.8.1 matrix**: response-format 1.8.0 only at ≤ v19; v20–25 fork transport (`node-fetch-native-with-agent@1.7.2`); v26+ switch to `undici` (format 1.9.5+ → server emits `x-appwrite-warning` "Please downgrade your SDK" on every response). **Fork transport is broken on Node 26**: its bundled-agent dispatcher against global fetch fails with `fetch failed / invalid onError method` (minimal repro: `fetch(url, {dispatcher: createAgent(...).dispatcher})`). Fix shipped: pin `node-appwrite@19.1.0` (exact 1.8.0 match) + `FORCE_NODE_FETCH=1` so the SDK uses its own bundled fetch end-to-end — proven by live probe. **⚠ The same env var MUST be added to the Easypanel service before first deploy or every login/API call fails in prod.**
3. **Live login probe (PR0 caveat)**: transport now works — server reachable, wrong creds return proper 401. But `admin@grupoecotech.com` (exists, `status` active, `verified=true`, `passwordUpdate 2026-06-09`) does NOT match `AGENDA_ADMIN_PASSWORD` in `.env.local` (32-char value generated "during provisioning", never applied to the user). **Still open, deferred by PR0 instruction**: orchestrator/user must set a known password (`PATCH /users/6a1030c90014c56a9568/password` via API key or console) before end-to-end login can be demonstrated. Out of executor scope — do not mutate credentials unattended.
4. `loadEnv(source: Readonly<Record<string, string | undefined>> = process.env)` — `NodeJS.ProcessEnv` now requires `NODE_ENV` (Next type augmentation).
5. `vitest.config.mts` (a `.ts` config produced a CJS/ESM warning) · `@types/node@^24` for vitest@5 peer · npm audit: 2 vulns (1 moderate, 1 high), noted not blocking.
6. Error UX via redirect query (`?error=credentials|missing|expired`) keeps `/login` a pure RSC — no client state machinery needed.

## Deviations from Design

- Middleware gained the expired-cookie clear branch (D2's presence gate stays presence-only: no JWT, no Appwrite call in edge) — forced by the RSC cookie restriction (discovery 1).
- `node-appwrite@19.1.0` + `FORCE_NODE_FETCH` instead of "latest SDK": exact server-format match beats version recency here (discovery 2); server log stays warning-free.

## Next

- **PR1 COMPLETE.** Before/at first deploy: (a) add `FORCE_NODE_FETCH=1` to the Easypanel service env, (b) enable GitHub auto-deploy on `grupo-ecotech-agenda`, (c) reset admin password (open PR0 caveat), then verify login end-to-end at `varios-grupo-ecotech-agenda.fjueze.easypanel.host`.
- Phase 3 / PR2 `schema-data-layer` (tasks 3.1–3.4, strict TDD) — start with RED `src/lib/validation/task.test.ts`.

---

# Batch 3 — Phase 3 / PR2 `schema-data-layer` (COMPLETE)

**Date**: 2026-10-04 · **Tasks**: Phase 3 all `[x]` (tasks.md 3.1–3.4 + added 3.5/3.6) · **Pushed**: `main` (see commits below), tree clean at docs commit
**Mode**: STRICT TDD — every task RED (observed failing output) → GREEN → triangulate
**Scope**: validation module + data-access layer against a FAKE injected client (design D5); no live Appwrite calls from tests; no React forms/UI (PR3).

## Task Status (batch 3 — orchestrator task ↔ tasks.md row)

- [x] 3.1 `src/lib/validation/task.ts` — task input validation: type in {task,request}; title 1..200 (trimmed); description cap 2000, MAY be empty (D1 + spec form rules — see Deviations); date `YYYY-MM-DD` with real-calendar check (2026-02-30 and 2025-02-29 rejected, 2024-02-29 ok, past dates ok); time `HH:mm` 00:00–23:59; derives `searchText` = `(title + " " + description)` prefix cut to 700 (D1 formula); server defaults via `buildTaskRecord`: status `open`, createdBy/createdByEmail from session. Plus `canTransition` status matrix (tasks.md 3.1–3.2). RED `src/lib/validation/task.test.ts`.
- [x] 3.2 `src/lib/appwrite/tasks.ts` — data access with INJECTED client: `createTask` (all 9 attrs inside `data`, `$permissions`-shaped `permissions` array `[read("user:<uid>"), write("user:<uid>"), read("team:<admins>")`], `ID.unique()` default), `listTasks` (cursor, page size 20, `date_time` + `$id` desc, `createdBy` filter for non-admin scope), `searchTasks` (JSON-string `search` query on `searchText`; empty q → unfiltered list), `updateStatus` (admin/owner path, matrix-gated, partial `{status}` write), visibility scoping per record-visibility (owner query double-enforced; admin no filter). RED `src/lib/appwrite/tasks.test.ts` with a recording fake asserting query shapes, `data` payload, permission arrays, cursor flow. (tasks.md 3.3–3.4)
- [x] 3.3 `src/lib/appwrite/errors.ts` — typed domain errors: kinds `unauthorized | session-expired | validation | not-found | unknown`; structural mapping (401+`*session*` type → session-expired, 401/403 → unauthorized, 400/422 → validation, 404 → not-found, else unknown); `DomainError` carries `kind` + `cause`; wired through ALL data-layer calls (passthrough, no double-wrap). RED `errors.test.ts` + RED wiring assertions (5 failed | 13 passed before wire).
- [x] 3.4 Integration glue — `loadHomeTasks` (session secret → injected `databasesFor` → `listTasks` with owner/admin scope) unit-tested; `getCurrentUser` already returns `{id, email}` (no extension needed); `/` placeholder now renders the server-side list for the logged-in user (admin scope aware, session-expired → `/login?error=expired`, other errors → inline error state). RED: `TypeError: loadHomeTasks is not a function` (2 failed).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `src/lib/validation/task.test.ts` | Unit (pure) | N/A (new); baseline 37/37 captured pre-batch | ✅ Written; observed `1 failed (1) / no tests` — `Cannot find module './task'` | ✅ 16 passed → 25 after triangulation | ✅ 200/201 title, 2000/2001 description, leap-year Feb 29, 00:00/23:59/12:60/9:00, 700-char cut, terminal matrix, multi-error collection | ➖ Already pure + constant-extracted |
| 3.2 | `src/lib/appwrite/tasks.test.ts` | Unit (fake injected client, D5) | ✅ 25/25 | ✅ Written; observed `1 failed (1) / no tests` — `Cannot find module './tasks'` | ✅ 10 passed → 14 after triangulation | ✅ admin search cross-user, empty-q delegation, cursor across empty page, terminal statuses, distinct default doc ids | ➖ Query builders already extracted (`listQueries`/`toTask`/`toPage`) |
| 3.3 | `src/lib/appwrite/errors.test.ts` + wiring in `tasks.test.ts` | Unit | ✅ 76/76 (full suite) | ✅ errors suite failed (`Cannot find module './errors'`) AND wiring RED `5 failed \| 13 passed` (assertions on `kind` before wiring) | ✅ errors 9/9; then wire → full suite 89/89 | ✅ 8 mapping cases (401 session/generic, 403, 400, 404, no-code, passthrough, non-Error) + 4 data-layer wiring cases | ✅ `readMessage` fix during GREEN (structural failures returned `[object Object]`) — implementation corrected, tests unchanged |
| 3.4 | `src/lib/appwrite/tasks.test.ts` (`loadHomeTasks`) + build smoke for the page | Unit + build | ✅ 89/89 | ✅ Written; observed `TypeError: loadHomeTasks is not a function` — `2 failed \| 18 passed` | ✅ 20/20 → full suite 91/91; `npm run build` green | ✅ owner scope (secret + `createdBy` query asserted) and admin scope (filter dropped) | ➖ None needed |

## Test Summary

- **New tests written**: 54 (validation 25, data layer 20, errors 9)
- **Suite growth**: 37/37 (4 files, PR1) → **91/91 (7 files)**
- **Layers**: Unit 54 (E2E/integration deferred to sdd-verify live probe — no network in tests per D5)
- **Pure functions created**: `validateTaskDraft`, `buildSearchText`, `buildTaskRecord`, `canTransition`, `toDomainError`, `isDomainError`, `listQueries`, `toTask`, `toPage`, `loadHomeTasks`

## Commits (all pushed to `main`)

| commit | subject | +/− | changed lines |
|---|---|---|---|
| `e8ed78c` | feat(validation): validate task drafts with real-calendar dates and status matrix | +457 / −0 | 457 |
| `9f448d9` | feat(appwrite): add tasks data access with injected client | +616 / −0 | 616 |
| `26d733d` | feat(appwrite): map Appwrite failures to typed domain errors | +347 / −42 | 389 |
| `4f78a4e` | feat(app): render server-side task list on home via data layer | +145 / −6 | 151 |
| (docs) | docs(openspec): record PR2 apply progress batch 3 | — | (this file + tasks.md) |
| **code total** | | **+1565 / −48** | **1613** |

**Budget note**: 400-line budget exceeded (forecast said 500–800; actual 1613 — test volume dominates: ~700 test lines). Recorded per-commit per chained-pr rule under `delivery_strategy: auto-forecast`; no stop-to-ask, as instructed. Mitigation applied: one work-unit commit per task, each independently green.

## Verification evidence (all green before push)

- `npx tsc --noEmit` — clean (after every task).
- `npx vitest run` — **7 files, 91/91 passed**.
- `npm run build` — green: `/` ƒ (dynamic, server list), `/login` ƒ, Middleware 39.3 kB.
- Composition-root seam verified by tsc probe: `node-appwrite@19` `Databases` structurally satisfies the hand-written `DatabasesLike` — no casts/adapters needed.

## Deviations from Design / Prompt

1. **`description` MAY be empty** (prompt said "1..2000"): design D1 ("may be `""`; form never blocks on it") and spec task-registration (only title/date/time/type block submit) win — acceptance specs are authoritative; only the 2000-char cap is enforced. ⚠ Live acceptance of `""` for this required attribute was NOT probed in PR0 → sdd-verify should create one empty-description record.
2. **`src/lib/appwrite/errors.ts` is a new file** not named in D3's File Changes table — task 3.3 requires typed errors; kept in the appwrite folder next to its consumers.
3. **`loadHomeTasks` extraction** — the page RSC itself is not unit-tested (node env, no jsdom); its wiring lives in this pure-ish function which IS tested; page covered by tsc/build + future runtime smoke (allowed by the task statement).
4. **tasks.md rows 3.5/3.6 added** to persist the orchestrator's error-mapping and glue tasks (original 3.1–3.4 rows kept as the RED/GREEN sub-steps they were).
5. `/` uses `isAdmin` for scope — prompt said "for the logged-in user", spec task-listing says "admins: all"; implemented the spec (admin sees all on the list, owner filter otherwise).

## Discoveries (batch 3 — read before PR3)

1. **Structural failure mapping**: initial `readMessage` only read `error.message` from `Error` instances; structural fakes (`{code, type, message}`) yielded `[object Object]`. Fixed to read a string `message` property from plain objects too — fakes and AppwriteException-like shapes both map cleanly.
2. **Query JSON shape gotcha (extends batch-0 gotcha 4)**: `JSON.stringify` drops `undefined` → `Query.limit(20)` serializes to `{"method":"limit","values":[20]}` and `Query.cursorAfter('x')` to `{"method":"cursorAfter","values":["x"]}` (NO `attribute` key). Assertions must match that exact shape.
3. **vitest RED comes in two flavors**: missing module → suite-level `Failed to load test file` (no tests collected); missing export on an existing module → per-test `TypeError: x is not a function`. Both observed and recorded as valid RED.
4. **Domain-error passthrough**: data-layer `catch → toDomainError` is idempotent (already-mapped errors return as-is), so nested wrappers (search → list, page → list) never double-wrap.

## Next

- **PR2 COMPLETE.** Next: Phase 4 / PR3 `list-search-create` (tasks 4.1–4.3, TDD): `/` list UI + search box + cursor next-link + `/nueva` form/action with inline errors — the action layer branches on `DomainError.kind` (task 3.3 output).
- sdd-verify (after PR3/PR4): live probe both roles + fulltext; still gated on a real admin password (PR0/PR1 caveat); add empty-`description` create probe (deviation 1).
