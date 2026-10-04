# Apply Progress: grupo-ecotech-agenda

**Phase**: Phase 1 / PR0 — Appwrite provisioning (scope of this batch)
**Mode**: Standard (strict_tdd: false — no test runner yet)
**Artifact store**: hybrid (OpenSpec file + Engram topic `sdd/grupo-ecotech-agenda/apply-progress`)
**Date**: 2026-10-04
**Batch**: 1 (first apply batch — no prior progress existed to merge)

## Task Status (cumulative)

- [x] 1.1 git init, first commits, push `main` → kike9083/grupo-ecotech-agenda — done in prior state handoff; AC re-verified this batch via `git ls-remote` (main @ `023ebd8`), working tree clean.
- [x] 1.2 Appwrite REST: DB `agenda`, collection `tasks`, 9 attributes per design D1 — AC met (all 9 `status: available`, exact types/sizes/required).
- [x] 1.3 Appwrite REST: fulltext index `searchText`; key (`date`,`time`) desc,desc — AC met (both `status: available`).
- [x] 1.4 Appwrite REST: team `admins` (owner admin@grupoecotech.com) + first user — membership created `confirm: true`, roles `["owner"]`. Caveat: "REST login works" NOT exercised (no password in scope by instruction); deferred to orchestrator/user.
- [x] 1.5 Fulltext probe (risk #1): seed, search hit, non-hit, delete — AC met; see probe log below. `searchText` size 700 accepted, no shrink needed.
- [ ] 1.6 Easypanel `varios` service + env vars + domain — OUT OF SCOPE for this batch.

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

## Deviations from Design

- `documentSecurity: true` on `tasks` (not an explicit D1 column, but required for D1/D2 permission enforcement; recorded above).
- No other deviations — schema, index types/orders, team/owner, and permissions shape match design D1/D2 exactly.

## Rollback Boundary

Only the new database `agenda` was created/modified → `DELETE /databases/agenda` reverts this entire batch. `crm-ge` and `ecotech_sitio_web` never touched. Teams: only new team `admins` created.

## Next

- PR0 remaining: task 1.6 (Easypanel service `varios/grupo-ecotech-agenda` + 6 env vars from D4 + domain) — then Phase 2 / PR1 `scaffold-auth`.
