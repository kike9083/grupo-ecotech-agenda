# Proposal: grupo-ecotech-agenda

## Intent

Team agenda to register tasks/requests (date + time) and find them by keyword. Records live in chats/spreadsheets: hard to find, no ownership. MVP: fast registration, search, list view, strict per-user visibility.

## Scope

### In Scope
- Auth: email/password, server sessions; member/admin roles (`admins` team, owner admin@grupoecotech.com)
- Register task|request: title, description, date, time, type, status
- Keyword search (Appwrite fulltext index); list view (own records; admin: all)
- New Appwrite DB `agenda`, collection `tasks` with document permissions
- Deploy: Easypanel `varios/grupo-ecotech-agenda` (nixpacks)

### Out of Scope
- Notifications, attachments, recurring tasks, edit history/audit trail
- Mobile app, multi-tenant; reuse of `crm-ge`/`ecotech_sitio_web`

## Capabilities

### New Capabilities
- `agenda-auth`: server-side login/session, admin-role detection
- `task-registration`: create records (title, description, date, time, type, status)
- `task-search`: keyword search via fulltext index
- `task-listing`: list view, empty states, pagination
- `record-visibility`: own records only; admins see all (`user:<uid>` r/w, `team:admins` r)

### Modified Capabilities
None — `openspec/specs/` empty (greenfield).

## Approach

Next.js 15 App Router SSR; all Appwrite calls via `node-appwrite` server clients — browser never talks to Appwrite (no CORS/platform registration). `tasks` in new `agenda` DB with fulltext index; visibility via doc permissions + server queries. Vitest installed first (strict_tdd false until then).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/` routes, server actions | New | Auth/register/search/list pages |
| `lib/appwrite/*` | New | Server client, queries, permissions |
| Appwrite `agenda`/`tasks` | New | Fulltext index + doc permissions |
| Easypanel `varios/grupo-ecotech-agenda` | New | Domain, env, deploy |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Fulltext index on self-hosted 1.8.x | Med | Probe index/query early in apply |
| Permission misconfig leaks records | Med | Server-only queries; verify both roles |
| Greenfield size exceeds 400-line budget | High | Forecast in tasks; chained PRs likely |
| No test runner yet | Med | Install Vitest as first task |

## Rollback Plan

Revert commits, remove Easypanel service, drop new `agenda` DB (ours only). Never touch `crm-ge`/`ecotech_sitio_web`.

## Dependencies

- Reachable Appwrite 1.8.x; `admins` team with owner
- Repo kike9083/grupo-ecotech-agenda (main); Easypanel project `varios`

## Success Criteria

- [ ] Register a task and find it by keyword
- [ ] Non-admin sees only own records; admin sees all
- [ ] Zero browser→Appwrite calls
- [ ] Live at varios-grupo-ecotech-agenda.fjueze.easypanel.host

## Proposal question round (open assumptions)

1. Status values (e.g., open/done)? Can users update status?
2. Date/time: timezone? Past dates allowed? Default sort = date/time?
3. Search matches title+description; admin search spans all records — confirm?
4. Both client and team members register their own items — confirm?
