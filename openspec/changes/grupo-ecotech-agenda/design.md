# Design: grupo-ecotech-agenda

## Technical Approach

Next.js 15 App Router; every Appwrite call runs server-side via `node-appwrite` — the browser never touches Appwrite. Data goes to a new `agenda` database (`config.yaml` rule: never reuse `crm-ge`/`ecotech_sitio_web`). Two server clients: a session-scoped one that lets Appwrite enforce document permissions, and an API-key one for admin writes only. Greenfield repo — conventions come from `openspec/config.yaml`, not existing code. Maps specs: `agenda-auth`/`record-visibility` → D2, `task-registration`/`task-search`/`task-listing` → D1/D3.

## Architecture Decisions

### D1 — `tasks` schema, search, permissions, pagination

| attribute | type | size | required | notes |
|---|---|---|---|---|
| `type` | enum `task`\|`request` | – | yes | form default `task` |
| `title` | string | 200 | yes | non-empty (form validation) |
| `description` | string | 2000 | yes | may be `""`; form never blocks on it |
| `date` | string | 10 | yes | `YYYY-MM-DD`, America/Panama wall clock, no conversion |
| `time` | string | 5 | yes | `HH:mm` |
| `status` | enum `open`\|`in_progress`\|`done`\|`cancelled` | – | yes | server writes `open` on create (Appwrite forbids DB defaults on required attributes) |
| `createdBy` | string | 36 | yes | session uid |
| `createdByEmail` | string | 255 | yes | admin attribution without user lookups |
| `searchText` | string | 700 | yes | `title + " " + description` prefix, computed on create |

Indexes: fulltext on `searchText`; key on (`date`,`time`) orders desc,desc. `$permissions` on create: `read("user:<uid>")`, `write("user:<uid>")`, `read("team:<admins>")`. Pagination: cursor via `Query.cursorAfter(lastId)`, page size 20, orders date desc, time desc, `$id` desc (stable tiebreak).

| Fulltext option | Tradeoff | Decision |
|---|---|---|
| Index `title`+`description` directly | combined 2200 chars ≈ 8.8 KB > 3072-byte max key length → index build fails (appwrite/appwrite#4903) | Rejected |
| Dedicated `searchText` (700) | ≤ 2.8 KB, safely under limit; one `Query.search` covers title OR description; matches past the 700-char prefix are missed | **Chosen** — probe index creation in apply; shrink `size` if the instance rejects it |

### D2 — Auth, session, roles

- Login server action: fresh client → `account.createEmailPasswordSession(email,pw)` → store returned `secret` in httpOnly cookie `aw_session` (path=/, sameSite=lax, secure in prod, maxAge=86400) → redirect `/`.
- Per request: `src/middleware.ts` (edge) checks cookie **presence** only (no Appwrite call), redirecting `/login`↔protected routes; each RSC then resolves identity via `setSession(secret)` → `account.get()`; invalid/expired clears cookie and redirects to `/login`.
- Admin: session `teams.list()` contains `APPWRITE_ADMINS_TEAM_ID`, memoized per request with React `cache()`.
- Logout: `account.deleteSession('current')` + cookie deletion.

| Client | Credential | Used for | Why |
|---|---|---|---|
| session client | cookie secret only | reads, create, owner status updates | Appwrite enforces `record-visibility` natively — peer isolation is not just a query filter |
| admin client | `APPWRITE_API_KEY` only | status override on **others'** records | `team:admins` is read-only per constraints, yet spec allows admin writes; gated by verified `isAdmin` |

### D3 — App structure

`src/` layout (keeps root config clean): routes `/login`, `/` (list), `/nueva`, `/admin` as server components; mutations exclusively via `'use server'` actions; one data-access module injected with a client; env centralized in one module. See File Changes.

### D4 — Env contract

Read only in `src/lib/env.ts` from runtime `process.env` (throws when missing in production); no `NEXT_PUBLIC_*` — nothing is browser-facing, and runtime reads keep values out of the build for nixpacks. Vars: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` (server-only), `APPWRITE_DATABASE_ID`, `APPWRITE_TASKS_COLLECTION_ID`, `APPWRITE_ADMINS_TEAM_ID`. Set in Easypanel at deploy.

### D5 — Test strategy

Vitest (installed first in slice 1, `environment: node`). Data-access takes an injected client, so tests pass a hand-written fake — no network, no SDK mocking. Validation and the status matrix are pure functions; session/cookie helpers run against mocked `next/headers`. E2E (Playwright) deferred; verify = unit suite + live probe against staging Appwrite.

### D6 — PR slicing (names only; forecast: chained PRs, 400-line risk High)

1. `scaffold-auth` — tooling, env, middleware, login/logout, session helpers.
2. `schema-data-layer` — provisioning, `tasks` data-access, validation + unit tests.
3. `list-search-create` — `/`, search, cursor pagination, `/nueva`.
4. `admin-polish-deploy` — `/admin`, attribution/override, UI states, deploy notes.

## Data Flow

```
Browser ──server action──▶ Next.js ──createEmailPasswordSession──▶ Appwrite
   ◀── Set-Cookie: aw_session (httpOnly) ──┘
Browser ──GET /──▶ middleware (cookie?) ──▶ RSC: account.get + teams.list → isAdmin
                        └─▶ listTasks({q,cursor}) ──session client──▶ agenda.tasks
                             member: + Query.equal('createdBy',uid)  (double-enforced)
                             admin : no filter (team read); non-owned writes → admin client
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/app/{layout,page}.tsx`, `src/app/{login,nueva,admin}/page.tsx` | Create | routes (RSC + forms) |
| `src/middleware.ts` | Create | cookie-presence gate |
| `src/lib/env.ts`, `src/lib/appwrite/{clients,session,tasks}.ts`, `src/lib/validation/task.ts` | Create | env, clients, session/roles, data access, validation |
| `src/actions/{auth,tasks}.ts` | Create | login/logout, create/update-status |
| `src/components/*` | Create | list, form, UI states, status badge |
| `vitest.config.ts`, `scripts/provision-appwrite.ts`, `package.json`, `next.config.ts`, Tailwind/tsconfig | Create | tooling + one-time schema provisioning (admin key) |

## Interfaces / Contracts

```ts
type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
type Task = { $id: string; type: 'task' | 'request'; title: string; description: string;
  date: string; time: string; status: TaskStatus; createdBy: string; createdByEmail: string };
// status matrix: open→[in_progress,cancelled], in_progress→[done,cancelled], done/cancelled terminal
// form rules: title non-empty; date matches valid YYYY-MM-DD; time matches HH:mm; type in enum
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | validation, status matrix, `tasks.*` (queries, cursors, permissions payload), env | Vitest + injected fake client, mocked cookies |
| Integration | live probe: fulltext index, search, both roles' visibility | scripted/manual against staging Appwrite in apply |
| E2E | full user journeys | deferred (out of scope for this change) |

## Migration / Rollout

No data migration — greenfield. One-time provisioning of `agenda`/`tasks` (attributes, indexes, `admins` team) before slice 2 works; then the four chained slices. Rollback: revert PRs and drop only the `agenda` database — never `crm-ge`/`ecotech_sitio_web`.

## Open Questions

- [ ] Does this 1.8.x instance accept a 700-char fulltext index? (probe in slice 2; fallback: reduce `searchText` size)
- [ ] Cursor "next" link vs load-more UX (default: next link)
