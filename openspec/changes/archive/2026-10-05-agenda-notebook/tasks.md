# Tasks: agenda-notebook (slice 1)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3,330 (range 2,900–3,900); per PR: 300 / 340 / 320 / 330 / 300 / 360 / 340 / 380 / 360 / 300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 notes-schema → PR2 notes-data → PR3 rich-text → PR4 notes-ui → PR5 att-schema → PR6 att-upload → PR7 att-display → PR8 calendar → PR9 date-filter → PR10 polish-deploy |
| Delivery strategy | auto-forecast — recorded, not asked |
| Chain strategy | stacked-to-main (each PR < 400 lines, green, revert = revert that PR) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base boundary |
|------|------|-----------|---------------|
| 1 | Notes schema + validation | PR1 | main |
| 2 | Notes data layer + action | PR2 | PR1 |
| 3 | Rich text (sanitize/plaintext + editor) | PR3 | PR2 |
| 4 | Notes UI + unified list | PR4 | PR3 |
| 5 | Attachments schema | PR5 | PR4 |
| 6 | Attachment upload + rollback | PR6 | PR5 |
| 7 | Attachment proxy display | PR7 | PR6 |
| 8 | Calendar grid | PR8 | PR7 |
| 9 | Date-range filter | PR9 | PR8 |
| 10 | Polish + deploy + verify | PR10 | PR9 |

TDD note: config `strict_tdd: false`, but Vitest is installed (`npm test`) and the repo's established pattern is test-first. Behavior tasks list the RED seam; infra tasks are marked "no tests possible".

## Phase 1: PR1 — notes-schema (infra + pure logic, ~300)

- [x] 1.1 Infra (no tests possible — live provisioning script): create `scripts/provision-notebook.ts` (idempotent, API-key) applying all D1/D3 changes below. AC: re-run is a no-op; existing docs untouched.
- [x] 1.2 Probe A (unverified 1.8.1): `updateEnumAttribute('tasks','type',{elements:['task','request','note'],required:true})`; fallback delete+recreate enum (collection `total=0`). AC: `note` accepted or fallback logged.
- [x] 1.3 Probe B: `createIndex('created_at','key',['$createdAt'],['desc'])`; fallback add `createdAt` ISO string attr + index. AC: undated ordering index active.
- [x] 1.4 RED `src/lib/validation/note.test.ts`: optional title/date, body normalization, sentinels (`''`). Specs: note-capture#Note creation (Dated/Undated). AC: fails first.
- [x] 1.5 GREEN `src/lib/validation/note.ts`: `validateNoteDraft`/`buildNoteRecord` (type `note`, title/date `''` ok, description `''`, status `open`, `searchText`). Spec: note-capture#Note creation.
- [x] 1.6 RED `src/lib/validation/task.test.ts` extension: `TASK_TYPES` includes `note`; task/request rules unchanged. Spec: task-registration#Task attachments (without attachment). AC: red first.
- [x] 1.7 GREEN `src/lib/validation/task.ts`: `TaskType` union + `TASK_TYPES` gain `note`; optional `bodyHtml`. Spec: task-registration.
- [x] 1.8 RED `src/lib/task-view.test.ts`: `typeLabel('note')` = "Nota"; `formatNotedAt` = "Anotado el …". Spec: note-capture#Creation timestamp display. AC: Spanish copy.
- [x] 1.9 GREEN `src/lib/task-view.ts`: add `note` label + `formatNotedAt`.

## Phase 2: PR2 — notes-data (~340)

- [x] 2.1 RED `src/lib/note-creation.test.ts`: payload `$permissions` (owner + `team:admins`), derived `searchText`, date/time sentinels; injected fake `Databases`. Spec: note-capture#Plain-text search index. AC: fails first.
- [x] 2.2 GREEN `src/lib/note-creation.ts`: `createNote` orchestration.
- [x] 2.3 RED `src/lib/appwrite/tasks.test.ts` extension: create maps `bodyHtml`; list orders `date`+`$createdAt` desc incl. undated notes. Spec: task-listing#Default listing (Sort/Undated note listed).
- [x] 2.4 GREEN `src/lib/appwrite/tasks.ts`: `bodyHtml` mapping; `$createdAt` order fallback; keep `Query.search`.
- [x] 2.5 RED `src/lib/note-creation.test.ts` extension: invalid draft → Spanish field errors, no write. Spec: note-capture#Note creation.
- [x] 2.6 GREEN `src/actions/notes.ts`: thin server action `validateNoteDraft` → `createNote` → redirect; verified via 2.2 units + `tsc`.

## Phase 3: PR3 — rich-text-editor (~320)

- [x] 3.1 Infra (no tests possible — dependency install): add `@tiptap/react`, `@tiptap/starter-kit`, `sanitize-html`, `@types/sanitize-html` to `package.json`; keep `sanitize-html` server-only. AC: resolves; build unaffected.
- [x] 3.2 RED `src/lib/rich-text.test.ts`: strips `<script>`/`onerror`/`javascript:`; plaintext derivation; bold/list/heading preserved. Specs: note-capture#Rich-text body and sanitization (Formatting round-trip, XSS stripped). AC: fails first.
- [x] 3.3 GREEN `src/lib/rich-text.ts` (server-only): `sanitizeNoteHtml`, `plainTextFromHtml`.
- [x] 3.4 `src/components/note-form.tsx` (client): Tiptap editor + title/date. Spec: note-capture#Formatting round-trip. Verified by `tsc`/build + integration probe.
- [x] 3.5 `src/components/note-body.tsx`: render `sanitizeNoteHtml` output. Spec: note-capture#XSS stripped.

## Phase 4: PR4 — notes-ui (~330)

- [x] 4.1 `src/app/nota/page.tsx` + note mode in `src/app/nueva/page.tsx`: create note (date optional). Spec: note-capture#Note creation. Verified by `tsc`/build + integration.
- [x] 4.2 RED `src/lib/task-view.test.ts` extension: note list branch + `formatNotedAt`. Specs: note-capture#Creation timestamp display; task-listing#Creation timestamp display. AC: fails first.
- [x] 4.3 GREEN `src/lib/task-view.ts` + `src/components/task-list.tsx`: sanitized note snippet, "Anotado el …", notes in unified list. Spec: task-listing#Default listing.
- [x] 4.4 RED `src/lib/note-ui-states.test.ts`: loading/empty/error Spanish copy. Spec: note-capture#Note UI states. AC: error + "Reintentar".
- [x] 4.5 GREEN UI states in note components; wire `src/app/page.tsx`.

## Phase 5: PR5 — attachments schema (~300)

- [x] 5.1 Infra (no tests possible — live infra): extend `scripts/provision-notebook.ts`: bucket `agenda-attachments` (`fileSecurity`, 30 MB, D3 extension list) + `attachments` collection (attrs `recordId`/`fileId`/`kind`/`name`/`mimeType`/`size`/`ownerId`, indexes `file_id` unique + `record_created`, perms mirror `tasks`). Spec: attachments#Attachment visibility. AC: matches D3.
- [x] 5.2 RED `src/lib/attachments.test.ts`: `validateAttachment` size/type matrix; `kindFromMime`. Spec: attachments#Attachment upload (Oversized or wrong type). AC: fails first.
- [x] 5.3 GREEN `src/lib/attachments.ts`.
- [x] 5.4 RED `src/lib/appwrite/attachments.test.ts`: doc payload perms mirror parent, list by `recordId`, unique `fileId`. Spec: attachments#Attachment visibility. AC: fake clients.
- [x] 5.5 GREEN `src/lib/appwrite/attachments.ts`.

## Phase 6: PR6 — attachments upload (~360)

- [x] 6.1 RED `src/lib/attachment-flow.test.ts`: `performUpload` creates file+doc, rollback deletes file on doc failure; `performDelete` removes both. Specs: attachments#Upload failure handling, #Attachment deletion. AC: fails first.
- [x] 6.2 GREEN `src/lib/attachment-flow.ts`.
- [x] 6.3 `src/app/api/attachments/upload/route.ts`: multipart, session authorizes parent, validate, create. Spec: attachments#Attachment upload. Verified by route-handler unit (mocked session) + live probe.
- [x] 6.4 RED `src/app/api/attachments/upload/route.test.ts`: size/type/unauthorized → 400/401, nothing stored. Spec: attachments#Oversized or wrong type.
- [x] 6.5 GREEN route; `src/actions/attachments.ts` delete action. Spec: attachments#Attachment deletion.
- [x] 6.6 `src/components/attachment-form.tsx`: file input, inline Spanish errors ("Archivo demasiado grande", "Tipo no soportado") + retry. Spec: attachments#Upload failure handling.

## Phase 7: PR7 — attachments display (~340)

- [x] 7.1 RED `src/app/api/attachments/[fileId]/route.test.ts`: 401 unauth, 404 unknown, 200 streams `mimeType`. Spec: attachments#Attachment visibility (Peer isolation/Admin read). AC: fails first.
- [x] 7.2 GREEN `src/app/api/attachments/[fileId]/route.ts`: session lookup by `fileId`, API-key `getFileView`, stream. Spec: attachments#Attachment display.
- [x] 7.3 `src/components/attachment-gallery.tsx` + `src/components/audio-player.tsx`: `<img src="/api/attachments/<fileId>">`, `<audio>`. Spec: attachments#Attachment display (Gallery and player). Verified by `tsc`/build.
- [x] 7.4 Wire attachment form/gallery into `src/components/task-form.tsx`. Spec: task-registration#Task attachments (Task with attachment).
- [x] 7.5 RED `src/lib/attachment-flow.test.ts` extension: admin vs peer read authorization. Spec: attachments#Attachment visibility.

## Phase 8: PR8 — calendar (~380)

- [x] 8.1 RED `src/lib/calendar.test.ts`: `buildMonthGrid` (leading/trailing days, placement), `gridRange`, `shiftMonth`. Specs: calendar-view#Month grid, #Month navigation. AC: pure math, fails first.
- [x] 8.2 GREEN `src/lib/calendar.ts`.
- [x] 8.3 `src/app/calendario/page.tsx` (RSC, session-guarded): parse `?month=&day=`, `Query.between('date', gridStart, gridEnd)`. Spec: calendar-view#Month grid (Dated placed/Undated excluded).
- [x] 8.4 `src/components/month-grid.tsx` + `src/components/day-cell.tsx`: GET links, create-from-day → `/nueva?date=`. Spec: calendar-view#Day selection.
- [x] 8.5 RED `src/lib/calendar.test.ts` extension: empty/loading/error copy. Spec: calendar-view#Calendar UI states. AC: empty Spanish message.
- [x] 8.6 `src/app/calendario/loading.tsx` + error/empty copy. AC: three states distinct.

## Phase 9: PR9 — date-filter (~360)

- [x] 9.1 RED `src/lib/search-query.test.ts` extension: parse `from`/`to`; `buildListHref` carries them; `validateDateRange` rejects malformed/`from>to`. Spec: task-search#Keyword search (Date range/Invalid range). AC: fails first.
- [x] 9.2 GREEN `src/lib/search-query.ts`: `from`/`to` + `validateDateRange` (Spanish inline error).
- [x] 9.3 RED `src/lib/appwrite/tasks.test.ts` extension: `listQueries` composes `between`/`greaterThanEqual`/`lessThanEqual` with `Query.search`. Spec: task-search (User search/Admin search/Keyword plus range).
- [x] 9.4 GREEN `src/lib/appwrite/tasks.ts`: extend `TaskScope` with `dateFrom`/`dateTo`.
- [x] 9.5 `src/components/search-form.tsx`: from/to date inputs + inline Spanish error. Spec: task-search#Invalid range.
- [x] 9.6 `src/app/page.tsx`: pass range + calendar entry link. Spec: task-listing#Calendar entry point.

## Phase 10: PR10 — polish-deploy (~300)

- [x] 10.1 UI states/copy pass (note/attachment/calendar) Spanish. Specs: note-capture#Note UI states, calendar-view#Calendar UI states, task-search#No match.
- [x] 10.2 Infra (no tests possible — docs): `README.md` + `.env.example` (bucket/collection provisioning, deps, commands). AC: docs match contract.
- [x] 10.3 Infra (no tests possible — config): `next.config.ts` server-only `sanitize-html` handling. AC: build green.
- [x] 10.4 Gates: `npx tsc --noEmit`, `npm test`, `npx next build` all green. AC: gates pass.
- [x] 10.5 Push → Easypanel auto-deploy; live probes (note create, image/audio upload, calendar placement, range search, peer isolation). AC: success criteria met. Deferred live ops to sdd-verify.
