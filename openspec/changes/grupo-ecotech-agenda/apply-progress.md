# Apply Progress: grupo-ecotech-agenda

**Phase**: Phase 5 / PR4 — admin-polish-deploy (current, COMPLETE — code; live ops → sdd-verify)
**Mode**: Standard (batch 1) → strict TDD (batch 2 from task 2.2, batches 3–5 fully)
**Artifact store**: hybrid (OpenSpec file + Engram topic `sdd/grupo-ecotech-agenda/apply-progress`)
**Date**: 2026-10-04
**Batches**: 1 = PR0 Appwrite provisioning (below, complete) · 2 = PR1 scaffold-auth (middle, complete) · 3 = PR2 schema-data-layer (bottom-but-one, complete) · 4 = PR3 list-search-create (middle-bottom, complete) · 5 = PR4 admin-polish-deploy (bottom, complete)

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

---

# Batch 4 — Phase 4 / PR3 `list-search-create` (COMPLETE)

**Date**: 2026-10-04 · **Tasks**: 4.1–4.3 all `[x]` · **Pushed**: `main @ 682e10e` (origin `kike9083/grupo-ecotech-agenda`), tree clean
**Mode**: STRICT TDD — every task RED (observed failing output) → GREEN → full gates → one work-unit commit per task
**Scope**: list UI + search + create flow only. Out: admin view/status UI (PR4), `loading.tsx` (PR4 task 5.3), live-network tests (sdd-verify), `/login` copy translation (PR1 file — follow-up flagged for PR4).

## Task Status (batch 4)

- [x] 4.1 `src/lib/task-view.ts` + `src/components/task-list.tsx`: display helpers (`statusLabel`, `typeLabel`, `formatCreatedBy`, `resolveListState`, `emptyMessage`, `buildListHref`, `LOAD_ERROR_MESSAGE`, `RETRY_LABEL`, `NEXT_PAGE_LABEL`) + `TaskList` RSC — status/type badges, creator attribution, empty/loading/error states, cursor "Siguiente" link preserving `q`. RED `src/lib/task-view.test.ts`.
- [x] 4.2 `src/lib/search-query.ts` + `src/components/search-form.tsx` + `loadHomeTasks(user, sessionSecret, admin, deps, params?)`: `parseHomeQuery` → `{q, cursor, searching, created}` (`RawSearchParams` pass-through), `normalizeSearchTerm`, search form with preserved input, dispatch to `searchTasks` when `q.trim() !== ''` else `listTasks` (scope `{admin:true}` / `{admin:false, ownerId}` unchanged, `cursorAfter` from cursor). RED ×3 streams (evidence below).
- [x] 4.3 `src/app/nueva/page.tsx`, `src/actions/tasks.ts`, `src/components/task-form.tsx` + `src/lib/task-creation.ts`: `performCreateTask(deps, draft, owner)` (validate → `onInvalid` OR `createTask` → `redirect('/?created=1')`, `DomainError.session-expired` → `/login?error=expired`, other kinds → Spanish form banner), thin `'use server'` action, client form on `useActionState`, "Nueva tarea" link + success banner on `/`. AC: invalid blocked inline with NO data-layer call; past date kept unchanged.

## TDD Cycle Evidence

| Task | Test File | RED (observed) | GREEN | TRIANGULATE | Gates |
|------|-----------|----------------|-------|-------------|-------|
| 4.1 | `src/lib/task-view.test.ts` | `Error: Cannot find module './task-view'` — 1 failed suite, 0 tests | 11/11 (→13 with 4.2 additions) | badges/labels both locales, creator attribution, `resolveListState` (loading/empty/error/page), `buildListHref` q+cursor | ✅ tsc · **8 files / 102 tests** · build green |
| 4.2 | `src/lib/search-query.test.ts` + glue in `task-view`/`tasks` | (a) `Cannot find module './search-query'`; (b) `expected '/?cursor=doc-20' to be '/?q=pago&cursor=doc-20'`; (c) `expected 'No hay tareas todavía.' to be 'Sin resultados.'`; + 2 `loadHomeTasks` glue failures | 3 files / 44 tests; full suite **115/115** | empty vs whitespace `q`, `searching` flag, cursor-only hrefs, search-vs-list dispatch + scope | ✅ tsc · 9 files / 115 · build green |
| 4.3 | `src/lib/task-creation.test.ts` + copy asserts in `validation/task.test.ts` | (a) 7 copy failures `Expected 'El título es obligatorio.' Received 'Title is required.'`; (b) `Cannot find module './task-creation'` | 35/35 (validation 25 + flow 10); full suite **125/125** | invalid-never-touches-data-layer, success payload + `/?created=1`, past-date backfill, 4 DomainError kinds mapped, multi-field collection, `INITIAL_CREATE_STATE` | ✅ tsc · 10 files / 125 · build green ( `/nueva` ƒ 4.32 kB ) |

## Test Summary

- **New tests written**: 34 (task-view 13, search-query 8, task-creation 10, `tasks.test.ts` glue +3)
- **Suite growth**: 91/91 (7 files, PR2) → **125/125 (10 files)**
- **Copy updates (not net-new)**: 7 validation assertions EN→ES with `ERROR_MESSAGES`
- **Layers**: all unit (node env, no jsdom — components/pages validated by `tsc`/`next build`); no live network per D5

## Commits (all pushed to `main`)

| commit | subject | +/− | changed lines |
|---|---|---|---|
| `b0fb679` | feat(app): render task list with badges, empty state and cursor next link | +295 / −28 | 323 |
| `6b94d71` | feat(app): add server-side keyword search with cursor-preserving pagination | +297 / −26 | 323 |
| `682e10e` | feat(app): add task creation flow with inline Spanish validation errors | +622 / −24 | 646 |
| (docs) | docs(openspec): record PR3 apply progress batch 4 | — | (this file + tasks.md) |
| **code total** | | **+1214 / −78** | **1292** |

**Budget note**: forecast 700–1100; actual 1292 (test volume dominates — `task-creation.test.ts` 209 lines, 13-test task-view suite). Recorded per-commit per chained-pr rule under `delivery_strategy: auto-forecast`; no stop-to-ask. Mitigation: one work-unit commit per task, each independently green. Gotcha hit & fixed: `task-list.tsx` missed staging in `6b94d71`'s first attempt → commit amended pre-push (amended commits must stay self-consistent over their whole tree).

## Verification evidence (green before every commit + final run)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **10 files, 125/125 passed**.
- `npm run build` — green: `Compiled successfully`, `/` ƒ 3.42 kB, `/nueva` ƒ 4.32 kB, `/login` ƒ, Middleware 39.3 kB.

## Deviations from Design / Prompt

1. **No `required`/native blocking on the create form** — spec acceptance says invalid input is "blocked with an inline error" on attempted submit; native `required` would intercept before the request, making the inline-error scenario untestable at e2e. Server validation is the single source of truth (inputs keep `maxLength` caps as soft guards).
2. **`src/lib/task-creation.ts` is a new file** not named in D3's file table — mirrors batch 2's `performLogin` so the flow is unit-testable in node env; the server action stays a thin adapter (deps injected: `createTask`/`onInvalid`/`redirect`).
3. **`ERROR_MESSAGES` translated EN→ES** (Spanish-UI constraint wins over source comments): 7 assertions updated to Spanish — RED observed before the change.
4. **`/login` copy still English** — PR1 file, out of PR3 scope; flagged as follow-up for PR4.
5. **Speculative-code discipline**: untested branches (`emptyMessage` searching variant, `buildListHref` q branch) were stripped to observe genuine RED first, then implemented GREEN.

## Discoveries (batch 4 — read before PR4/verify)

1. **React 19 `useActionState` + `defaultValue` from returned state** is the canonical value-preservation pattern after failed submissions (verified against React docs) — no controlled-input machinery needed; the action returns `{fieldErrors, formError, values}` and the form re-renders from it.
2. **`redirect()` returns `never`** → TS narrows null session checks after the guard (no extra assertions needed in action/page).
3. **`'use server'` files may only export async functions** — all flow logic must live in plain lib modules with injected deps; helpers like `readDraft` stay module-local.
4. **vitest env is `node`** — React components/RSCs cannot be unit-rendered; pattern is: pure helpers + flow functions unit-tested, components validated by `tsc --noEmit` + `next build`.
5. **PS 5.1 gotchas hit again**: no `||` across commands (use `if ($?)`); embedded quotes in PowerShell strings mangle — prefer the Edit tool for file content.

## Next

- **PR3 COMPLETE.** Next: Phase 5 / PR4 (tasks 5.x): admin view/status UI + `loading.tsx` + `/login` Spanish copy follow-up.
- sdd-verify (after PR4): live e2e both roles, fulltext search probe, empty-`description` create probe (batch-3 deviation 1), inline-error acceptance run — still gated on a real admin password (PR0/PR1 caveat).

---

# Batch 5 (PR4) — admin-polish-deploy · 2026-10-04 · COMPLETE (code; Easypanel deploy + live probes → sdd-verify)

**Scope**: tasks 5.1–5.3 fully (strict TDD) + 5.4 code parts (sweep, gates, push). Out: Easypanel deploy/live-network probes (deferred to sdd-verify per apply scope), README (Phase 6).

## Task Status (batch 5)

- [x] 5.1 `src/app/admin/page.tsx` + `src/lib/admin-gate.ts` + `src/components/admin-task-list.tsx` + `resolveAdminAccess` test: admins-team gated all-records view with `createdByEmail` attribution; signed-in non-admin → `notFound()` (404) before any data read; Spanish `admin/not-found.tsx`. AC: creators shown.
- [x] 5.2a Filters: `parseAdminQuery` (enum-validated status/type, trimmed creator, `filtered` flag) + `buildAdminHref` carrying filters across pages + `AdminListParams`/`loadAdminTasks` → `listQueries` `Query.equal` pushes + GET filter form on `/admin` + `adminEmptyMessage`. AC: empty vs filtered-empty distinct, pagination keeps filters.
- [x] 5.2b Transitions: `src/lib/task-status.ts` `performStatusUpdate` (local gates: malformed/illegal → `invalid`, non-owner non-admin → `forbidden`, NO data-layer call; owner → session client, admin non-owned → API-key client per D2) + `updateStatusAction` thin adapter (`revalidatePath` on ok, redirect on session-expired, Spanish message otherwise) + `StatusControls` client form wired into home `TaskList` AND admin rows + `allowedTransitions`/`statusActionLabel` derived from `canTransition`. AC: owner-advance + admin-override pass (unit).
- [x] 5.3 Polish: `src/lib/login-copy.ts` (`LOGIN_ERROR_MESSAGES` ES + fallback) + `/login` copy EN→ES + `loading-state` component + `src/app/loading.tsx` + `src/app/admin/loading.tsx` + admin header link on `/`. AC: three UI-state scenarios distinct (loading / empty / error+retry).
- [x] 5.4 Code sweep: middleware `/admin` presence-gate regression ×2, env contract verified (6 `SERVER_ENV_KEYS` + `FORCE_NODE_FETCH` = 7 in `.env.example`), no `console.*` in `src`, no EN UI copy left, full gates green, pushed to `origin/main`. **Live part (Easypanel deploy, both-role probe, fulltext probe) deferred to sdd-verify.**

## TDD Cycle Evidence

| Task | Test file | RED (observed) | GREEN | Gates after |
|------|-----------|----------------|-------|-------------|
| 5.1 | `admin-gate.test.ts` + `search-query`/`tasks` glue | `Cannot resolve './admin-gate'` (1 failed suite); `TypeError: buildAdminHref is not a function` (2 failed \| 8 passed); `TypeError: loadAdminTasks is not a function` (2 failed \| 23 passed) | **132/132 (11 files)** | tsc · vitest · build `/admin ƒ` |
| 5.2a | `search-query.test.ts`, `tasks.test.ts`, `task-view.test.ts` | 12 failed: `parseAdminQuery is not a function` ×5, `adminEmptyMessage is not a function` ×2, 2 behavioral href mismatches, `admin filters` ×3 | **144/144 (11 files)** | tsc · vitest · build green |
| 5.2b | `task-status.test.ts` + `task-view.test.ts` | `Cannot find module './task-status'` (1 failed suite); `allowedTransitions is not a function` ×3; `statusActionLabel is not a function` ×1 | **162/162 (12 files)** | tsc · vitest · build `/admin ƒ` |
| 5.3 | `login-copy.test.ts` | `Cannot find module './login-copy'` (1 failed suite) | **166/166 (13 files)** | tsc · vitest · build green |
| 5.4 | `middleware.test.ts` (regression guards) | none expected — guards for existing middleware behavior, pass on addition | **168/168 (13 files)** | tsc · vitest · build `/admin ƒ` |

## Commits (batch 5, all on `main`)

| commit | subject | +/− | changed lines |
|---|---|---|---|
| `507f3e9` | feat(admin): add admins-team gated all-records view with attribution | +395 / −1 | 396 |
| `535c975` | feat(admin): add status, type and creator filters to the admin view | +411 / −30 | 441 |
| `f1ef707` | feat(tasks): add owner and admin status transitions on task rows | +543 / −5 | 548 |
| `6dfaca5` | feat(ui): add Spanish login copy, loading states and admin header link | +105 / −11 | 116 |
| (docs) | docs(openspec): record PR4 apply progress + 5.4 sweep | — | (this file + tasks.md + middleware guards) |
| **code total** | | **+1454 / −47** | **1501** |

**Budget note**: auto-forecast exceeded (chained-pr rule) — recorded per-commit as required, no stop-to-ask; each work-unit commit independently green.

## Decisions recorded (5.x)

1. **Signed-in non-admin on `/admin` → `notFound()` (404)**, not a redirect or 403 page: literal record-visibility ("B gets none of A's data"), no info disclosure, and `resolveAdminAccess` stays pure/testable. Spanish `admin/not-found.tsx` for UX.
2. **Status controls on BOTH home rows and admin rows**: record-visibility "Owner write" + task-registration "Owner advances" are unreachable for non-admins if controls live only on `/admin` (404 for them).
3. **Trust model for the status form**: hidden fields (`documentId`/`createdBy`/`from`/`to`) are server-rendered but advisory; Appwrite document permissions are the enforcement backstop; `performStatusUpdate` re-checks input/transition/ownership before ANY data-layer call. Known limitation: fields are spoofable → rejected locally, never trusted for authorization.
4. **Creator filter = exact `Query.equal('createdByEmail')`, unindexed** — consistent with PR3's unindexed `createdBy` usage; no schema changes allowed.
5. **GET filter form drops `cursor`** by design — applying filters always resets to the first page (intended UX).

## Discoveries (batch 5 — read before verify/archive)

1. **`revalidatePath` comes from `next/cache`, NOT `next/navigation`** — build failed with TS2305; only `redirect` lives in `next/navigation` inside server actions.
2. **TS2367 on typed-union vs `''`**: `params.status !== ''` where `status?: TaskStatus` is a no-overlap comparison — enum guards only need the `undefined` check once the type is narrowed.
3. **`useActionState` returns `[state, formAction, isPending]`** in React 19 — third element drives the `disabled` buttons on `StatusControls` without extra state.
4. **`TASK_STATUSES` filter + `canTransition`** derives `allowedTransitions` with zero duplication — UI can never offer an illegal move because both action and UI read the same matrix.
5. **PS 5.1 gotchas confirmed again**: `if ($?)` chaining, no `||`; Edit tool for file content over embedded shell strings.

## Next

- **Phase 5 code COMPLETE.** Next in workflow: **sdd-verify** — live e2e (both roles, status flows, filters, fulltext, empty-description probe, inline-error run) + Easypanel deploy (5.4 live part). Still gated on a real admin password (PR0/PR1 caveat).
- After verify: Phase 6 README (6.1) + sdd-archive (delta-spec sync).


## Task Status (batch 6 — verify re-entry: F1, F2, F3, F3b, task 1.6)

| Item | Fix | Status |
|------|-----|--------|
| F1 login secret | New `src/lib/appwrite/login-transport.ts` + `login-transport.test.ts`; wired in `src/actions/auth.ts` | ✅ live: 303 + 398-char `aw_session` (Max-Age 86400) + `GET /` 200 |
| F3 create denied | Infra (no code): collection `tasks` `$permissions=[create("users"), read("team:admins")]`, `documentSecurity: true` | ✅ live: member create 201, member list own-only, member GET peer 404, admin list all |
| F3b team grant 401 | `createTask` sends `[read(user), write(user)]` only; grant moved to collection level; tests updated + triangulation test | ✅ 29/29; app e2e member `POST /nueva` → `303 /?created=1`, member home own-only, admin home all |
| F2 `/admin` 200 | Removed `src/app/admin/loading.tsx` **and root `src/app/loading.tsx`**; home loading UX via co-located `<Suspense>`; structural guard in `admin-gate.test.ts` | ✅ live: member `/admin` 404, admin `/admin` 200, member `/` 200 |
| Task 1.6 checkbox | `tasks.md` flipped to `[x]` (stale checkbox) | ✅ |

## TDD Cycle Evidence (batch 6)

| Finding | RED (observed) | GREEN (observed) | Final gates |
|---|---|---|---|
| F1 | `Cannot find module './login-transport'` | **8/8** `login-transport.test.ts` | tsc 0 · 178/178 · build ✓ |
| F3b | 2 failed (team grant asserted) → **29 pass** target | **29/29** `tasks.test.ts` | tsc 0 · 178/178 · build ✓ |
| F2 structural | `expected true to be false` (admin file), then again on root file restore | **4/4** `admin-gate.test.ts` | tsc 0 · 178/178 · build ✓ |
| F3 | repro first (401 team grant / 201 without) — infra change, no unit test target | REST probes green | live probes below |

## Test Summary (batch 6 final)

- `npx tsc --noEmit` → exit 0 · `npx vitest run` → **178 passed (14 files)** (168 baseline + 8 F1 + 1 F3b + 1 F2 guard) · `npm run build` → compiled clean.
- Live acceptance (local `next start -p 3100`, fresh build): F1 303/non-empty cookie/`GET /` 200 · F2 member 404 + admin 200 + `/` 200 · F3/F3b app e2e 303 `/?created=1` with per-role home isolation.
- Cleanup: collection `tasks` left `total=0` (probe docs `probe-member-1`, `probe-admin-1`, `E2E F3b task` deleted).

## Deviations from verify's analysis (batch 6)

1. **F2 root cause is the ROOT `loading.tsx`, not only `admin/loading.tsx`** — removing only the admin segment left member `GET /admin` → 200; removing root `src/app/loading.tsx` → 404 (empirical A/B on the same build). Fix therefore removes BOTH boundaries; home UX preserved by co-located `<Suspense>` around `HomeTasksSection` (task 5.3 `LoadingState` kept in use).
2. **F1 root cause confirmed exactly as reported**: keyless `POST /account/sessions/email` → body `secret:""` with populated `Set-Cookie: a_session_<pid>=…`; API-key request → body `secret` populated.
3. **`record-visibility` wording**: spec text says document permissions include `team:admins` read; after F3b the team grant lives at COLLECTION level (`read("team:admins")`) — intent (admins read all) preserved, document payload is creator-only `[read(user), write(user)]`. Archive should reconcile the wording during delta-spec sync.
4. **F3 collection-level grant is permanent product config** — `create("users")` at collection level is what makes member creates work at all (documentSecurity create requires an explicit collection-level `create` grant).

## Commits (batch 6, `main`)

| subject | scope |
|---|---|
| `fix(auth): recover Appwrite login secret from response body or cookie (F1)` | `login-transport.ts` + test + `actions/auth.ts` |
| `fix(tasks): send creator-only document permissions on task create (F3b)` | `tasks.ts` + `tasks.test.ts` |
| `fix(admin): drop route-level loading boundaries so member 404 reaches the wire (F2)` | admin+root `loading.tsx` removed, `page.tsx` Suspense, `loading-state.tsx`, `admin-gate.test.ts` |
| `docs(openspec): record verify fixes F1–F3b, sync task 1.6, batch 6 progress` | `tasks.md`, `verify-report.md`, `apply-progress.md` |

## Discoveries (batch 6 — read before archive)

1. **A root `loading.tsx` wraps every child route's stream** — it commits 200 for `/admin` before `resolveAdminAccess → notFound()` runs; a segment-local loading file is NOT the only offender.
2. **Appwrite `secret` is only returned when the request carries an API key** — keyless session creation still returns a usable `Set-Cookie: a_session_*`, but the SDK client discards it; the raw fetch must read the cookie as fallback (legacy `_legacy` variant ignored).
3. **PS 5.1 native-arg quoting**: multipart values containing `{"` break `curl -F '…'` assembled inline; write value to a temp file and use `-F 'name=<file'`; query strings with `[]` need `-g` (curl globbing) and URL-encoded brackets.
4. **React 19 progressive-enhancement forms** (`useActionState`) post `$ACTION_REF_1`/`$ACTION_1:0`/`$ACTION_KEY`, not `$ACTION_ID_*` — replay requires the exact envelope from a fresh GET.

## Next

- **Batch 6 code + docs COMPLETE.** Push to `main` → Easypanel auto-deploy (orchestrator monitors). Then: re-run verify on prod (F1/F2/F3/F3b acceptance), Phase 6 README (6.1), and **sdd-archive** (delta-spec sync incl. record-visibility wording above).
