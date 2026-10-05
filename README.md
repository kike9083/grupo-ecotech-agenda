# grupo-ecotech-agenda

Shared team agenda for Grupo Ecotech: register tasks and requests with a date and
time, capture rich-text notes, attach images/audio, and find everything by
keyword or date range — with a month calendar view. Server-rendered Next.js app
backed by a self-hosted Appwrite instance.

## Stack

- Next.js 15 (App Router, React Server Components) + TypeScript
- Tailwind CSS
- Tiptap (rich-text editor) + `sanitize-html` (server-side render)
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
  app/            routes: / (list+search), /login, /nueva, /nota, /calendario, /telegram, /admin
  actions/        server actions (auth, tasks, notes, attachments, telegram)
  components/     presentational components
  lib/
    appwrite/     clients, session, login-transport, data access, errors
    validation/   input validation (task, note)
    env.ts        centralized server-only env contract
  middleware.ts   cookie-presence gate
  instrumentation.ts  boots the reminder runner loops (see "Telegram reminders")
```

### Features

- **Tasks / requests** — dated records with a lifecycle status.
- **Notes** — rich-text (sanitized on render), optional date; undated notes
  still list, ordered by creation time.
- **Attachments** — images and audio, up to 30 MB, streamed to the browser
  through an authorized proxy (`/api/attachments/<fileId>`); Appwrite URLs are
  never exposed.
- **Search** — fulltext keyword plus an optional inclusive date range
  (`?from=&to=`).
- **Calendar** — a hand-rolled month grid at `/calendario` placing every dated
  record (`?month=YYYY-MM`, `?day=YYYY-MM-DD`).
- **Telegram reminders** — optional per-creator reminders for dated records
  with a time; link at `/telegram`, see "Telegram reminders" below.

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

The six **optional** reminder keys are documented, with their own table, under
[Telegram reminders](#telegram-reminders) — absence disables the feature and the
app still boots.

## Provisioning

The app expects an Appwrite database with a `tasks` collection, an
`attachments` collection, an `agenda-attachments` storage bucket, and an
`admins` team. The additive schema (note enum value, `bodyHtml`, the
`created_at` index, the bucket and the attachments collection) is applied by an
idempotent script that only needs the API key:

```bash
node scripts/provision-notebook.ts   # reads APPWRITE_* from .env.local; re-run is a no-op
```

Manual equivalent, if you prefer the console:

1. **Database** — one database for the agenda.
2. **Collection `tasks`** with `documentSecurity` enabled and these attributes:
   `type` (enum `task,request,note`), `title`, `description`, `date`, `time`,
   `status`, `createdBy`, `createdByEmail`, `searchText`, and optional
   `bodyHtml` (100000).
3. **Indexes** — a key index on the date/time fields, a **fulltext** index on
   `searchText`, and a key index on `$createdAt` (undated-note ordering).
4. **Bucket `agenda-attachments`** — `fileSecurity`, 30 MB, extension allow-list
   `jpg,jpeg,png,webp,heic,webm,mp3,wav,ogg,m4a,mp4,aac`.
5. **Collection `attachments`** — `recordId`, `fileId`, `kind` (enum
   `image,audio`), `name`, `mimeType`, `size`, `ownerId`; unique `file_id`
   index + `record_created` index; permissions mirror `tasks`.
6. **Collection permissions** — `create("users")` and `read("team:admins")`.
7. **Team `admins`** — add every admin user as a member.

Record the resulting IDs in `.env.local`.

## Telegram reminders

Optional, per-creator reminders: a dated record **with a time** sends one
Telegram message to its creator when it comes due. The feature is fully
off by default — with no Telegram configuration the app runs exactly as
before (spec `reminder-delivery` → "Disabled or unconfigured reminders").

### Runner behavior

`src/instrumentation.ts` boots at server start (Next 15 `nodejs` runtime) and
starts **two loops**, owned by a single process-wide record so a double boot
or dev HMR never starts a second pair:

- **Bot loop** — long-polls `getUpdates` and answers `/start <link-token>` by
  self-POSTing `{ token, chatId }` to `POST /api/telegram/link` with the
  shared-secret header, then confirms in the chat. Only terminal outcomes
  advance the offset; transient failures (network, 5xx, 429) keep it so
  Telegram re-delivers.
- **Scheduler loop** — every `REMINDERS_POLL_SECONDS` (default 60): loads due,
  unnotified records for the last 24 h from Appwrite, intersects them with
  active linked subscriptions, and sends **one message per record, then marks
  `notified`** (send-then-mark: a crash in between can duplicate once, never
  lose). Transient send failures are retried on the next poll while still
  inside the window; a `403` (bot blocked) deactivates that user's
  subscription so no further sends target them.

Both loops catch their own errors, back off `min(interval · 2^n, 5 min)` and
reset on the next success — a failing dependency can never crash the server.
`SIGTERM` stops both loops and aborts the in-flight long poll so the
container exits cleanly.

### ⚠️ Single replica — hard constraint

The scheduler has **no leader election**: two replicas would both poll and
both send (duplicate messages). The Easypanel service `grupo-ecotech-agenda`
must run **exactly one replica** — do not enable scaling while the runner
code is present, regardless of `REMINDERS_ENABLED`.

### Linking

At `/telegram` (or the **Telegram** entry in the list header, which always
shows the current status):

1. **Generar enlace** mints a single-use token (43 chars, 10-minute TTL) and
   shows a plain `https://t.me/<bot>?start=<token>` anchor — re-minting kills
   the previous link.
2. Opening it in Telegram makes the bot store the chat binding and confirm:
   "Vinculación correcta…".
3. **Desvincular** clears the binding (`chatId`/`token` reset, `active:false`)
   and reminders stop for that user.

Chat ids are never displayed in the UI and never logged. States: not
configured / unlinked / linked / blocked (blocked = the user blocked the bot;
recovery is manual re-link from the same page).

### Environment

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather — together with the next two, gates the feature |
| `TELEGRAM_BOT_USERNAME` | Bot username, `@`-less (used to build deep links) |
| `TELEGRAM_LINK_SECRET` | Shared secret for the callback header — generate with `openssl rand -hex 32` |
| `REMINDERS_ENABLED` | Set to `false` to stop both loops even when the three keys exist |
| `REMINDERS_POLL_SECONDS` | Poll interval in seconds (default `60`, invalid falls back) |
| `TELEGRAM_CALLBACK_ORIGIN` | Origin the bot self-POSTs to (default `http://127.0.0.1:3000`) |

All six are **server-only**; never prefix them `NEXT_PUBLIC_*`. The loader
never throws: missing keys simply report disabled.

**Dev/prod anti-pattern:** never run local dev and production against the
**same bot token** — `getUpdates` is exclusive, so your dev process steals
updates from production (and vice versa). Use a separate dev bot, or leave
the keys unset locally so the feature stays disabled there.

### Easypanel steps (production)

1. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_LINK_SECRET`
   in the service environment **first** (the app boots without them; the
   feature activates as soon as they exist).
2. Set `TELEGRAM_CALLBACK_ORIGIN` to the public origin (`https://<domain>`).
3. Confirm **one replica** for `grupo-ecotech-agenda`.
4. Deploy, then link from `/telegram`.

### Rollback

- **Feature flag:** set `REMINDERS_ENABLED=false` and restart — both loops
  stop, the linking page shows the not-configured copy, the rest of the app is
  untouched.
- **Full revert:** the reminders PRs stack onto `main`, so revert them in
  reverse order.

### Scheduled-function fallback

The token-exchange endpoint (`POST /api/telegram/link`) is a plain HTTP route
with a shared-secret header precisely so it stays callable from outside the
in-process loops: if long-polling/instrumentation ever becomes unavailable,
the same `runReminderPoll` cycle can be triggered by an Appwrite scheduled
function (or any cron) while linking keeps working unchanged. The in-process
runner is the supported path today; this is the documented escape hatch.

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
in `openspec/changes/agenda-notebook/` (proposal, specs, design, tasks, apply
progress, verification report). Its predecessor is archived under
`openspec/changes/archive/grupo-ecotech-agenda/`.
