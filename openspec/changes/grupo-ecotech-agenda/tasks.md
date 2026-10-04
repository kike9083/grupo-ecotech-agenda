# Tasks: grupo-ecotech-agenda

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

| Field | Value |
|-------|-------|
| Estimated changed lines | Total ~2,400–3,800; PR0 150–350, PR1 600–900, PR2 500–800, PR3 700–1,100, PR4 400–700 |
| Delivery strategy | auto-forecast — recorded, not asked |
| Suggested split | PR0 infra → PR1 scaffold-auth → PR2 schema-data-layer → PR3 list-search-create → PR4 admin-polish-deploy |
| Work units | One phase = one PR; rollback = revert that PR |

PR1–PR4 exceed 400 lines; stack on `main`, each green.

## Phase 1: Infrastructure (PR0 — no tests possible: infra)

- [x] 1.1 `git init`, first conventional commit (README, `openspec/`), push `main` → kike9083/grupo-ecotech-agenda. AC: remote serves commit.
- [x] 1.2 Appwrite REST: DB `agenda`, collection `tasks`, 9 attributes per design D1. AC: attributes match D1.
- [x] 1.3 Appwrite REST: fulltext index `searchText`; key (`date`,`time`) desc,desc. AC: both active.
- [x] 1.4 Appwrite REST: team `admins` (owner admin@grupoecotech.com) + first user. AC: REST login works.
- [x] 1.5 Fulltext probe (risk #1): seed, `Query.search` hits; shrink `searchText` if rejected. AC: match logged.
- [ ] 1.6 Easypanel `varios`: service `grupo-ecotech-agenda`, GitHub main, 6 env vars (D4), domain; deploy post-2.1. AC: healthy.

## Phase 2: PR1 — scaffold-auth (bootstrap; no tests possible pre-Vitest)

- [x] 2.1 `package.json`, `next.config.ts`, `tsconfig.json`, Tailwind, `vitest.config.ts`, `src/app/layout.tsx`: toolchain bootstrap, no tests possible yet. AC: `npx next build` + `npx vitest run` exit 0.
- [x] 2.2 `src/lib/env.ts` (D4). Test (first): `src/lib/env.test.ts`. AC: missing prod var throws.
- [x] 2.3 `src/lib/appwrite/{clients,session}.ts`: session/admin clients, isAdmin (`teams.list`). Test: fake clients, mocked headers. AC: no session redirects.
- [x] 2.4 `src/middleware.ts`: cookie-presence gate `/`↔`/login`. Test: redirect cases. AC: anonymous redirected.
- [x] 2.5 `src/app/login/page.tsx` + `src/actions/auth.ts`: login/logout, httpOnly `aw_session`. Test: action units. AC: cookie set/error/cleared.

## Phase 3: PR2 — schema-data-layer (strict TDD)

- [x] 3.1 RED `src/lib/validation/task.test.ts`: field rules + status matrix. AC: fails first.
- [x] 3.2 GREEN `src/lib/validation/task.ts`. AC: validation + matrix green.
- [x] 3.3 RED `src/lib/appwrite/tasks.test.ts`: create payload ($permissions, `searchText`, `open`), own/admin list, cursor, override. AC: fails first.
- [x] 3.4 GREEN `src/lib/appwrite/tasks.ts` (injected fake). AC: `npx vitest run` green; peer-isolation + admin-read pass.
- [x] 3.5 Map Appwrite errors to typed domain errors (`src/lib/appwrite/errors.ts`: unauthorized/session-expired, validation, not-found, unknown; wired through the data layer). Test: RED `errors.test.ts` + wiring assertions. AC: actions can branch on `kind`.
- [x] 3.6 Integration glue: `loadHomeTasks` + `/` renders the server-side list for the logged-in user (admin scope aware). Test: RED glue units; AC: page covered by `tsc`/`vitest`/`build` green.

## Phase 4: PR3 — list-search-create (TDD)

- [ ] 4.1 `src/app/page.tsx` + `src/components/task-list.tsx`: sorted cursor list (20/page). Test: 3.3 units. AC: later-first, pagination.
- [ ] 4.2 Search box + `Query.search`, empty→unfiltered, next link. Test: search units. AC: user/admin/no-match scenarios.
- [ ] 4.3 `src/app/nueva/page.tsx`, `src/actions/tasks.ts`, `src/components/task-form.tsx`: create + inline errors. Test: action units. AC: invalid blocked; past date kept.

## Phase 5: PR4 — admin-polish-deploy

- [ ] 5.1 `src/app/admin/page.tsx`: all records attributing `createdByEmail`. AC: creators shown.
- [ ] 5.2 Admin override (API-key, gated `isAdmin`). Test: override unit. AC: owner-advance + admin-override pass.
- [ ] 5.3 `src/components/*`: loading/empty/error+retry states. AC: three UI-state scenarios distinct.
- [ ] 5.4 Push → Easypanel deploy; live probe both roles + fulltext. AC: success criteria met.

## Phase 6: Docs

- [ ] 6.1 README: env (D4), provisioning, run/test commands. AC: docs match contract.
