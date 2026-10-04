# grupo-ecotech-agenda

Shared team agenda for Grupo Ecotech: register tasks and requests with a date and
time, then find them by keyword. Server-rendered Next.js app backed by a
self-hosted Appwrite instance.

## Stack

- Next.js 15 (App Router, React Server Components) + TypeScript
- Tailwind CSS
- Vitest for unit tests
- Appwrite (self-hosted) via `node-appwrite` — server-side only

## Architecture

The browser **never** talks to Appwrite. Every Appwrite call happens on the
server through `node-appwrite`, using either:

- a **session client** built from the `aw_session` cookie (per-user identity), or
- an **API-key client** used by admins for cross-record operations.

Mutations run exclusively through `'use server'` actions. Reads are RSC routes.
This keeps the Appwrite API key off the client and removes the need to register
browser platforms (no CORS).

```
src/
  app/            routes: / (list+search), /login, /nueva, /admin
  actions/        server actions (auth, tasks)
  components/     presentational components
  lib/
    appwrite/     clients, session, login-transport, data access, errors
    validation/   input validation
    env.ts        centralized server-only env contract
  middleware.ts   cookie-presence gate
```

### Roles and visibility

- **Member** — any authenticated user. Creates tasks and sees only their own.
- **Admin** — member of the `admins` team. Sees every record and can override
  status transitions.

Isolation is enforced by Appwrite permissions: documents are created with
creator-only grants (`read/update/delete` for `user:<id>`), while the
collection-level `read("team:admins")` grant lets admins read all records.
Collection-level `create("users")` lets any authenticated user create.

## Requirements

- Node.js 22 (pinned via `.nvmrc`)
- An Appwrite instance with a project and API key

> On Node 26, `node-appwrite`'s bundled agent dispatcher is incompatible with the
> runtime's `fetch`. Set `FORCE_NODE_FETCH=1` so the SDK uses its own fetch.

## Environment

Copy `.env.example` to `.env.local` and fill in the values. These are
**server-only** — there are no `NEXT_PUBLIC_*` variables.

| Variable | Purpose |
| --- | --- |
| `APPWRITE_ENDPOINT` | Appwrite API endpoint (e.g. `https://…/v1`) |
| `APPWRITE_PROJECT_ID` | Appwrite project ID |
| `APPWRITE_API_KEY` | Server API key |
| `APPWRITE_DATABASE_ID` | Database holding the agenda collection |
| `APPWRITE_TASKS_COLLECTION_ID` | Tasks/requests collection ID |
| `APPWRITE_ADMINS_TEAM_ID` | Team ID whose members are admins |
| `FORCE_NODE_FETCH` | Set to `1` on Node 26 (see above) |

## Provisioning

The app expects an Appwrite database with a `tasks` collection and an `admins`
team. Create them once:

1. **Database** — one database for the agenda.
2. **Collection `tasks`** with `documentSecurity` enabled and these attributes:
   `type`, `title`, `description`, `date`, `time`, `status`, `ownerId`,
   `ownerEmail`, `searchText`.
3. **Indexes** — a key index on the date/time fields and a **fulltext** index on
   `searchText` (keyword search relies on it).
4. **Collection permissions** — `create("users")` and `read("team:admins")`.
5. **Team `admins`** — add every admin user as a member.

Record the resulting IDs in `.env.local`.

## Development

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # Vitest unit suite
npm run build    # production build
npm start        # serve the production build
```

## Deploy

Deployed on Easypanel (project `varios`, service `grupo-ecotech-agenda`) from
this repository's `main` branch, with auto-deploy enabled. The build uses
Nixpacks and honors `.nvmrc` for the Node version.

## Spec

This project follows the OpenSpec workflow. The change that introduced it lives
in `openspec/changes/grupo-ecotech-agenda/` (proposal, specs, design, tasks,
apply progress, verification report).
