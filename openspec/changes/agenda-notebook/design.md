# Design: agenda-notebook (slice 1)

## Technical Approach

Additive extension of the existing `agenda.tasks` collection (verified: 9 required attributes, `documentSecurity:true`, collection perms `[create("users"), read("team:admins")]`, doc-level `[read/write("user:<uid>")]`, indexes `date_time` + `search_text`). `note` joins the `type` enum; new optional `bodyHtml`; `searchText` reused. Rich text is Tiptap (client) + `sanitize-html` (server render). Attachments live in a new `agenda-attachments` bucket + `attachments` collection, all access server-side. Calendar is a hand-rolled RSC grid; the date range composes with `q` in the existing query builder. Maps: note-capture→D1/D2, attachments→D3, calendar-view→D4, task-listing/search deltas→D1/D5. Self-hosted Appwrite 1.8.1 — every unverifiable schema step is an apply-time probe with a fallback.

## Architecture Decisions

### D1 — Notes live in `tasks` as `type='note'` (not a separate collection)

| Option | Tradeoff | Decision |
|---|---|---|
| Separate `notes` collection | Native optional title/date, but the unified list/search/calendar would need cross-collection merge + cursor pagination (two cursors, ordering, totals) — the exact complexity the specs forbid | Rejected |
| `note` enum value in `tasks` | Requires sentinel values for required attrs (title/date/time `''`, description `''`, status `open`); one collection keeps listing, search, visibility, pagination and calendar unchanged | **Chosen** — matches proposal "additive extension" and spec "coexisting with task\|request" |

Exact schema changes (apply-time, additive, `agenda.tasks` currently `total=0` so all fallbacks are data-safe):

| Change | Detail | Fallback |
|---|---|---|
| `type` enum | `updateEnumAttribute({ elements:['task','request','note'], required:true })` — confirmed API exists | If 1.8.1 rejects: delete+recreate enum (collection empty) |
| `bodyHtml` | `createStringAttribute` size **100000**, `required:false` (tasks omit it) | — |
| order index | `createIndex('created_at','key',['$createdAt'],['desc'])` to order undated notes by creation | If system attr indexing unsupported: add `createdAt` ISO string attr (empty collection) |

Note vs task/request differences: title optional (`''`), description unused (`''`), `date`/`time` optional (`''` when absent → excluded from calendar by `between`), status inert `open` (no controls), body in `bodyHtml`, `searchText = title + plainText(bodyHtml)`.

### D2 — `searchText` stays at 700; derive + truncate, do NOT enlarge

| Option | Tradeoff | Decision |
|---|---|---|
| Enlarge attribute/index | Fulltext index key ceiling ≈3072 bytes; Spanish/multibyte makes >700 risky, and rebuilding a proven `available` index adds migration risk | Rejected |
| Second fulltext attribute for body | `Query.search` ORs across two indexes only via two merged queries — pagination breaks | Rejected |
| Truncate at 700 | Keywords past the 700-char prefix unsearchable (documented limitation) | **Chosen** — covers the spec scenario, no index migration |

Derivation: `buildSearchText(title, plainTextFromHtml(bodyHtml)).slice(0,700)`. Optional apply-time probe may raise to 1200 (empty collection) if ever needed.

### D3 — Attachments: new bucket + collection, proxy-served (no temporary URLs)

Bucket `agenda-attachments`: `fileSecurity:true`, `maximumFileSize:31457280` (30 MB), `allowedFileExtensions:['jpg','jpeg','png','webp','heic','webm','mp3','wav','ogg','m4a','mp4','aac']` (mirrors precedent `service-report-images`/`-audio`).

`attachments` collection: `documentSecurity:true`, collection `[create("users"), read("team:admins")]`, doc `[read/write("user:<ownerId>")]` — mirrors `tasks`. Attributes: `recordId`(str 36, req), `fileId`(str 36, req), `kind`(enum `image|audio`, req), `name`(str 255, req), `mimeType`(str 100, req), `size`(int, req), `ownerId`(str 36, req). `createdAt` uses Appwrite `$createdAt` (no custom attribute — no drift). Indexes: `file_id` unique key (`fileId`), `record_created` key (`recordId` asc, `$createdAt` asc).

| Serving option | Tradeoff | Decision |
|---|---|---|
| Appwrite resource **token** URL (`POST /tokens/buckets/.../files/...`) | Confirmed to exist, but the browser would fetch directly from Appwrite — violates the hard SSR-only rule; token is a bearer capability leaking via history/referrer | Rejected |
| Proxy route | Browser only sees `/api/attachments/<fileId>`; authorization enforced server-side; Appwrite URLs never exposed | **Chosen** |

All storage ops use the API-key client after app-level authorization (avoids the F3b team-grant trap). Uploads/deletes: route handler + server action; reads: proxy route. Per-file perms `[read/write("user:<owner>")]` + `read("team:admins")` mirror the parent.

### D4 — Calendar: hand-rolled RSC grid, URL-driven

Hand-rolled (no dependency) — repo currently ships only next/react/node-appwrite; date math is small and pure-testable. Alternatives `react-day-picker`/FullCalendar rejected (weight, client state). Route `/calendario/page.tsx` (RSC, session-guarded) parses `?month=YYYY-MM&day=YYYY-MM-DD`; `MonthGrid`/`DayCell` are presentational. Day selection and month nav are GET links (consistent with the app's no-client-state pattern); create-from-day links to `/nueva?date=…`. Query the visible grid range via `Query.between('date', gridStart, gridEnd)` (inclusive) on the existing `date_time` index.

### D5 — Date range composes with `q` in the existing builder

Extend `TaskScope` with `dateFrom?`/`dateTo?`; `listQueries` appends `Query.between('date', from, to)` (both), `greaterThanEqual` (from only) or `lessThanEqual` (to only). Appwrite ANDs `Query.search` + range. Validation (`validateDateRange`) rejects malformed or `from > to` with a Spanish inline error and runs no query. Undated notes (`date=''`) are excluded whenever a range is set — correct. URL `/?q=&from=&to=&cursor=`; `parseHomeQuery`/`buildListHref` extended.

## Data Flow — attachments

```
form(File) --multipart POST /api/attachments/upload--> Route Handler
  cookie -> session user; session client: authorize parent record
  validate ext/MIME/size; storage.createFile(API key, perms)
  databases.createDocument(attachments, perms)   // on failure: delete file (rollback)
Browser <img src="/api/attachments/<fileId>">
  GET /api/attachments/[fileId]: session client queries attachments by fileId
    found -> storage.getFileView + fetch bytes (API key) -> stream(mimeType)
    not found -> 404
```

## File Changes

| File | Action | Description |
|---|---|---|
| `scripts/provision-notebook.ts` | Create | Idempotent additive provisioning (enum, bodyHtml, indexes, bucket, collection) — closes prior verify gap (no scripts/) |
| `src/lib/validation/note.ts`, `src/lib/rich-text.ts`, `src/lib/calendar.ts`, `src/lib/attachments.ts`, `src/lib/note-creation.ts`, `src/lib/attachment-flow.ts` | Create | Pure logic + flows |
| `src/lib/appwrite/attachments.ts` | Create | Data/storage access, injected client |
| `src/actions/notes.ts`, `src/actions/attachments.ts` | Create | Thin server actions |
| `src/app/api/attachments/upload/route.ts`, `src/app/api/attachments/[fileId]/route.ts` | Create | Upload (avoids 1 MB Server-Action body cap) + authorized proxy |
| `src/app/{nota,calendario}/page.tsx`, `src/components/{note-form,note-body,attachment-form,attachment-gallery,audio-player,month-grid,day-cell}.tsx` | Create | UI |
| `src/lib/{validation/task,task-view,search-query,appwrite/tasks}.ts`, `src/components/{task-form,task-list,search-form}.tsx`, `src/app/{page,nueva}/page.tsx`, `package.json`, `next.config.ts` | Modify | `note` enum/type union, bodyHtml, date-range filter, from/to inputs, Tiptap+sanitize deps |

## Interfaces / Contracts

```ts
type TaskType = 'task' | 'request' | 'note';
type AttachmentKind = 'image' | 'audio';
interface Attachment { $id:string; recordId:string; fileId:string; kind:AttachmentKind;
  name:string; mimeType:string; size:number; ownerId:string; $createdAt:string }
// rich-text.ts (server-only): sanitizeNoteHtml(html): string; plainTextFromHtml(html): string
// note.ts: validateNoteDraft(draft) -> {ok:true,value}|{ok:false,errors}; buildNoteRecord(draft,owner)
// calendar.ts: buildMonthGrid(year,month): DayCell[]; gridRange(year,month): {start,end}; shiftMonth
// attachments.ts: validateAttachment({name,type,size}) -> ok | 'too-large' | 'unsupported-type'; kindFromMime
// search-query.ts: validateDateRange(from,to): {ok}|{ok:false,error}
```

DomainError kinds unchanged (`validation` covers file rejection, `unauthorized` covers attachment denial).

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | rich-text sanitize/plaintext (XSS: `<script>`, `onerror`), note validation, calendar grid math, date-range validation, query-builder shape, attachment validation, `performUpload/Delete` rollback | Vitest node + hand-written fake `Databases`/`Storage` (existing D5 pattern) |
| Integration | proxy 401/404/200, upload size/type rejection, admin vs peer read | Route-handler unit with mocked session + live probe in apply |
| E2E | full journeys | deferred (Playwright) |

## Migration / Rollout

Additive-only; existing documents untouched. Run `scripts/provision-notebook.ts` once (API key) before deploy; probes enum-update and system-attr indexing with documented fallbacks. Rollback: revert commits; drop `agenda-attachments` bucket + `attachments` collection; delete `bodyHtml`; `updateEnumAttribute` back to `task,request`. Never touch `crm-ge`/`ecotech_sitio_web`.

## Risks

- Next Server Actions cap bodies at 1 MB → uploads use a route handler, not an action.
- `sanitize-html` is server-only; importing it in a client module breaks the build (enforced by module placement).
- 30 MB buffered in memory per upload — acceptable for a 2-user internal app; revisit if concurrency grows.
- Tiptap adds ~100 KB to the `/nueva` route (client chunk only).
- Enum/update and `$createdAt` indexing unverified on 1.8.1 — apply-time probes with data-safe fallbacks.

## PR Slice Plan (each < 400 lines; stages = proposal names)

| Stage | PR | Files | Est. |
|---|---|---|---|
| A `notes-schema` | 1 schema | `scripts/provision-notebook.ts`, `validation/{task,note}.ts`, `task-view.ts` + tests | ~300 |
| A | 2 notes-data | `appwrite/tasks.ts`, `note-creation.ts`, `actions/notes.ts` + tests | ~340 |
| B `rich-text-editor` | 3 rich-text | `rich-text.ts`, `note-form.tsx`, `note-body.tsx`, deps + tests | ~320 |
| B | 4 notes-ui | `app/{nota,nueva}`, `task-list.tsx` note rendering + `note-view` tests | ~330 |
| C `attachments` | 5 att-schema | provisioning, `attachments.ts`, `appwrite/attachments.ts` + tests | ~300 |
| C | 6 att-upload | `api/attachments/upload/route.ts`, `attachment-flow.ts`, `attachment-form.tsx`, delete action + tests | ~360 |
| C | 7 att-display | `api/attachments/[fileId]/route.ts`, `attachment-gallery.tsx`, `audio-player.tsx` + tests | ~340 |
| D `calendar-date-filter` | 8 calendar | `calendar.ts`, `app/calendario`, `month-grid.tsx`, `day-cell.tsx` + tests | ~380 |
| D | 9 date-filter | `search-query.ts`, `appwrite/tasks.ts`, `search-form.tsx` + tests | ~360 |
| E `polish-deploy` | 10 polish | UI states/copy, README/env docs, deploy, verify | ~300 |

## Open Questions

- [ ] Does self-hosted 1.8.1 accept `updateEnumAttribute` and `$createdAt` indexing? (probe in PR1; fallbacks documented)
- [ ] Should HEIC be transcoded server-side for non-Safari browsers? (default: serve as-is)
