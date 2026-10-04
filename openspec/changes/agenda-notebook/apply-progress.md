# Apply Progress: agenda-notebook (slice 1) — Batch 1 (phases 1–4 / PR1–PR4, "notes")

**Change**: `agenda-notebook` · **Batch**: 1 of N — **notes slice only (PR1 notes-schema → PR2 notes-data → PR3 rich-text-editor → PR4 notes-ui)**
**Mode**: STRICT TDD (orchestrator-injected; Vitest 5 present, repo pattern is test-first even though `config.yaml strict_tdd: false`)
**Artifact store**: hybrid (this file + Engram topic `sdd/agenda-notebook/apply-progress`)
**Date**: 2026-10-04
**Out of scope this run (later run)**: phases 5–10 — attachments (PR5–PR7), calendar (PR8), date-range filter (PR9), polish/deploy (PR10).

## Task Status (cumulative — phases 1–4)

All 25 tasks of phases 1–4 marked `[x]` in `tasks.md`. Phases 5–10 remain `[ ]`.

- [x] 1.1 `scripts/provision-notebook.ts` — idempotent API-key provisioning (enum + bodyHtml + created_at index); re-run is a no-op (verified).
- [x] 1.2 Probe A `updateEnumAttribute` — **FAILED on 1.8.1** (see probes); documented fallback delete+recreate applied.
- [x] 1.3 Probe B `createIndex('created_at','key',['$createdAt'],['desc'])` — **SUCCEEDED**; no fallback needed.
- [x] 1.4/1.5 RED→GREEN `src/lib/validation/note.ts` (+test) — `validateNoteDraft`/`buildNoteRecord`, optional title/date, sentinels, `searchText`.
- [x] 1.6/1.7 RED→GREEN `src/lib/validation/task.ts` — `TaskType`/`TASK_TYPES` gain `note`; optional `bodyHtml`; existing note-rejection tests updated to `bogus`.
- [x] 1.8/1.9 RED→GREEN `src/lib/task-view.ts` — `typeLabel('note')="Nota"`, `formatNotedAt` = "Anotado el …".
- [x] 2.1/2.2 RED→GREEN `src/lib/note-creation.ts` (+test) — validate → `plainTextFromHtml` → `buildNoteRecord` → `createTask` → `/?noted=1`.
- [x] 2.3/2.4 RED→GREEN `src/lib/appwrite/tasks.ts` — `bodyHtml` + `$createdAt` mapped; list orders `date, time, $createdAt, $id` desc.
- [x] 2.5 note-creation triangulation — invalid draft (Spanish errors, no write) + 4 `DomainError.kind` branches.
- [x] 2.6 `src/actions/notes.ts` — thin `createNoteAction` adapter (verified by tsc/build + 2.2 units).
- [x] 3.1 deps — `@tiptap/react@3.31.4`, `@tiptap/starter-kit@3.31.4`, `sanitize-html@2.18.0`, `@types/sanitize-html`.
- [x] 3.2/3.3 RED→GREEN `src/lib/rich-text.ts` — `plainTextFromHtml` (PR2) + `sanitizeNoteHtml` (server-only whitelist).
- [x] 3.4/3.5 `src/components/note-form.tsx` (client Tiptap, `immediatelyRender:false`) + `note-body.tsx` (server sanitized render).
- [x] 4.1 `src/app/nota/page.tsx` + "Nueva nota" link on `/nueva` (see deviation 3).
- [x] 4.2/4.3 RED→GREEN `task-view.ts` note helpers + `task-list.tsx` note branch (sanitized body, "Anotado el …", no status controls).
- [x] 4.4/4.5 RED→GREEN `src/lib/note-ui-states.ts` (+test) + `NoteBody` empty state + `page.tsx` (`/?noted=1` banner + "Nueva nota" entry point).

## Probe Results — unverified Appwrite 1.8.1 operations

| Probe | Call | Result | Fallback used |
|-------|------|--------|---------------|
| A — enum update | `PATCH /databases/agenda/collections/tasks/attributes/enum/type` `{elements:['task','request','note'],required:true}` | **FAILED**: `HTTP 400 general_argument_invalid "Param \"default\" is not optional."` — 1.8.1 requires a `default` param that the design's probe omitted | **YES** — `DELETE /attributes/type` then `POST /attributes/enum` with all three elements. Delete succeeded but the first recreate raced `409 attribute_already_exists` (attribute lingers in `deleting`); fixed by polling until the attribute is gone. Final `type` = `task,request,note`, `required:true`, `status:available`. |
| B — system-attr index | `POST /indexes` `{key:'created_at',type:'key',attributes:['$createdAt'],orders:['desc']}` | **SUCCEEDED**: `HTTP 202`, index `3_1_created_at` reached `status:available` | **NO** — `$createdAt` indexing works on 1.8.1. The `createdAt` ISO-attribute fallback was **not** needed. |

**Verdict**: the design's data-safe fallback for A was exercised (collection was empty; existing documents untouched). B needs no fallback, so the write path stays `$createdAt`-based — no `createdAt` attribute was added, no design change.

### Live schema after provisioning (`agenda.tasks`)

| attribute | status | required | size | elements |
|---|---|---|---|---|
| `type` | available | yes | – | `task,request,note` |
| `bodyHtml` | available | no | 100000 | – |
| (existing 8 attrs) | available | unchanged | unchanged | unchanged |

Indexes: `date_time` (date,time DESC), `search_text` (fulltext searchText), **`created_at`** (`$createdAt` desc) — all `available`. Collection `documentSecurity:true`, perms `[create("users"), read("team:admins")]` unchanged.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED (observed) | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|----------------|-------|-------------|----------|
| 1.1 | — (infra) | live REST | n/a | n/a — provisioning script; re-run no-op verified | n/a | n/a | n/a |
| 1.2/1.3 | — (probes) | live REST | n/a | n/a | A failed → fallback; B passed | n/a | n/a |
| 1.4/1.5 | `src/lib/validation/note.test.ts` | Unit (pure) | n/a (new); baseline 178/178 | ✅ `Cannot find module './note'` | ✅ 11/11 | ✅ untitled/undated/valid-date/long-title/700-cut | ➖ already pure |
| 1.6/1.7 | `src/lib/validation/task.test.ts` | Unit (pure) | ✅ 25/25 | ✅ `expected false to be true` ×2 | ✅ 27/27 | ✅ TASK_TYPES order + note accepted + bogus rejected | ➖ message updated |
| 1.8/1.9 | `src/lib/task-view.test.ts` | Unit (pure) | ✅ 11/11 | ✅ `noteSnippet is not a function` / 4 failed | ✅ 26/26 | ✅ note label, 2 timestamps, fallback, snippet/heading | ➖ `MONTHS_ES` extracted |
| 2.1/2.2 | `src/lib/note-creation.test.ts` | Unit (fake `Databases`) | ✅ 194/194 | ✅ `Cannot find module './note-creation'` | ✅ 3/3 | ✅ dated note payload + undated sentinel + perms | ➖ none |
| 2.3/2.4 | `src/lib/appwrite/tasks.test.ts` | Unit (fake client) | ✅ 31/31 | ✅ 3 failed (missing `$createdAt`/`bodyHtml`, missing order query) | ✅ 31/31 | ✅ bodyHtml round-trip, `$createdAt` order, undated list | ➖ `toTask` conditional spread |
| 2.5 | `src/lib/note-creation.test.ts` | Unit | ✅ 3/3 | ➖ **not observed separately** — branches shipped in the 2.2 flow; added as triangulation (see Deviation 1) | ✅ 8/8 | ✅ invalid draft + 4 `DomainError.kind` branches | ➖ none |
| 2.6 | — (adapter) | build/tsc | n/a | n/a — thin `'use server'` adapter over tested flow | n/a | n/a | n/a |
| 3.1 | — (deps) | install/build | ✅ 209/209 | n/a | ✅ `npm install` clean; build green | n/a | n/a |
| 3.2/3.3 | `src/lib/rich-text.test.ts` | Unit | ✅ 5/5 | ✅ `sanitizeNoteHtml is not a function` ×5 | ✅ 10/10 | ✅ script/onerror/javascript: stripped + formatting preserved | ✅ `as const` removed for `IOptions` |
| 3.4/3.5 | — (components) | tsc/build | ✅ 214/214 | n/a — components covered by `tsc`/`next build` (node vitest cannot render) | ✅ build green (`/nota` 195 kB) | n/a | n/a |
| 4.1 | — (page) | tsc/build | ✅ 214/214 | n/a | ✅ build green | n/a | n/a |
| 4.2/4.3 | `src/lib/task-view.test.ts` | Unit (pure) | ✅ 22/22 | ✅ `noteSnippet is not a function` ×4 | ✅ 26/26 | ✅ snippet truncation/trim, heading precedence, placeholder | ➖ helpers pure |
| 4.4/4.5 | `src/lib/note-ui-states.test.ts` | Unit (pure) | ✅ 22/22 | ✅ `Cannot find module './note-ui-states'` | ✅ 4/4 | ✅ empty/loading/error copy + body classifier | ➖ none |
| 4.5 (banner) | `src/lib/search-query.test.ts` | Unit (pure) | ✅ 18/18 | ✅ 5 failed (missing `noted`) | ✅ 19/19 | ✅ exact `noted=1` marker + neutral default | ➖ none |

### Test Summary

- **New tests written**: 45 (note validation 11, note-creation 8, rich-text 10, note-ui-states 4, task-view note/format 7, search-query `noted` 1, tasks `bodyHtml`/`$createdAt` 3, plus enum/helper triangulations)
- **Suite growth**: 178 passed (14 files, baseline) → **222 passed (18 files)**
- **Layers**: Unit only (node env, no jsdom — pages/components validated by `tsc` + `next build`; live probes in PR1 REST)
- **Pure functions created**: `validateNoteDraft`, `buildNoteRecord`, `plainTextFromHtml`, `sanitizeNoteHtml`, `performCreateNote`, `noteSnippet`, `noteHeading`, `formatNotedAt`, `resolveNoteBodyState`
- **Live REST probes**: 2 (enum update failed→fallback, `$createdAt` index passed)

## Commits (all pushed to `origin/main`)

| commit | subject | +/− | changed lines |
|--------|---------|-----|---------------|
| `24ca06e` | feat(notebook): add idempotent note schema provisioning script | +387 / −0 | 387 |
| `9d3b46f` | feat(validation): add note drafts and the note record type | +291 / −10 | 301 |
| `74428ea` | feat(ui): label notes and format the creation timestamp in Spanish | +56 / −1 | 57 |
| `d23307e` | feat(rich-text): derive plain text from note HTML | +71 / −0 | 71 |
| `0aa7ccd` | feat(appwrite): map bodyHtml and order undated records by creation time | +76 / −1 | 77 |
| `7a8ceda` | feat(notebook): persist notes with derived search text and sentinels | +348 / −0 | 348 |
| `19ec12d` | feat(notebook): add create-note server action | +74 / −0 | 74 |
| `c6b400f` | chore(deps): add tiptap editor and server-side sanitizer | +835 / −6 | 841 (**830 is generated `package-lock.json`**) |
| `ca44eff` | feat(rich-text): sanitize stored note HTML on render | +103 / −4 | 107 |
| `0543ccf` | feat(notebook): add Tiptap note form and sanitized note body | +174 / −0 | 174 |
| `d8e0605` | feat(ui): render notes in the unified list with timestamp and body | +105 / −31 | 136 |
| `bde583b` | feat(ui): add the note empty state copy | +65 / −4 | 69 |
| `bfc2532` | feat(notebook): add the note create page and home entry point | +86 / −8 | 94 |

**Totals**: code +1,884 / −66 changed lines (excluding the 830-line generated lockfile). **Budget note**: the forecast said ~300–340/PR; actual is dominated by test volume (`note-creation.test.ts` 244, `note.test.ts` 138, `rich-text.test.ts` 72) — same pattern as batches 3–5 of the archived change. Work-unit commits keep every commit ≤ 387 lines except the generated lockfile; recorded per `work-unit-commits` / chained-pr rules under `delivery_strategy: auto-forecast`, no stop-to-ask.

## Gates (green before every push)

- `npx tsc --noEmit` → **exit 0**
- `npx vitest run` → **18 files, 222/222 passed**
- `npm run build` → **Compiled successfully**; routes `/`, `/admin`, `/login`, `/nueva` + **new `/nota` (ƒ 195 kB / 310 kB First Load)**, Middleware 39.3 kB

## Deviations from Design / tasks.md

1. **Task 2.5 RED not observed in isolation** — the invalid-draft and `DomainError.kind` branches were implemented as part of the 2.2 flow; the 2.5 tests are triangulation over that implementation. Assertions exercise real production branches (no-write on invalid, 4 error mappings), but the strict RED step for 2.5 was folded into 2.2. Flagged for verify.
2. **`rich-text.ts` created in PR2, not PR3** — `buildNoteRecord` derives `searchText` from body plain text and `performCreateNote` needs `plainTextFromHtml`; the dependency is real and cannot wait for PR3. PR2 ships the plaintext half; PR3 adds `sanitizeNoteHtml` to the same file.
3. **Task 4.1 "note mode in `/nueva`"** implemented as a "Nueva nota" link on `/nueva` (and a "Nueva nota" button on home), plus the dedicated `/nota` route — not a mode toggle inside the task form. No shared form state was introduced; keeps both flows simple.
4. **Note permissions are creator-only** — tasks.md 2.1 says payload `$permissions` "(owner + `team:admins`)", but verify fix F3b (archived apply-progress) proved a member session cannot grant `team:admins` (401); the team grant lives at collection level. Notes use the same creator-only grants as tasks. tasks.md wording predates F3b.
5. **`$createdAt` added to the `Task` read model** (required field) — needed for "Anotado el …"; existing test fixtures (`task-view`, `task-status`, `task-creation`) updated to supply it.
6. **`TaskRecord` gained optional `bodyHtml`** (task 1.7) and `Task` gained optional `bodyHtml` — notes carry it, tasks/requests omit it.
7. **`type` enum error copy** changed from `El tipo debe ser "task" o "request".` to `El tipo de registro no es válido.` (the old message was no longer true once `note` joined the enum). Existing assertions updated to `toBeDefined()`.

## Discoveries / Gotchas (read before PR5+)

1. **1.8.1 `updateEnumAttribute` requires `default`** (`general_argument_invalid`) — for a required, defaultless enum this is awkward; the delete+recreate fallback is the reliable path. On delete, the attribute stays in `deleting` for a moment → **poll until it disappears** before recreating, or you get `409 attribute_already_exists`. Script now handles both (create-if-missing + wait-for-gone).
2. **`$createdAt` is indexable on 1.8.1** — `createIndex` with `attributes:['$createdAt']` returns 202 and reaches `available`. No `createdAt` attribute needed.
3. **`sanitize-html` + TS**: `as const` on the options object makes arrays `readonly`, incompatible with `IOptions` (`AllowedAttribute[]`); annotate the object as `sanitizeHtml.IOptions` instead.
4. **Tiptap v3 + Next 15 SSR**: `useEditor({ immediatelyRender: false, ... })` is required to avoid a hydration mismatch; the body is mirrored into a hidden `<input name="bodyHtml">` and the editor's `onUpdate` keeps it in sync. `/nota` First Load is 310 kB (Tiptap client chunk, as design anticipated).
5. **`rich-text.ts` is server-only** (imports `sanitize-html`) — never import it from a client component. `task-view.ts` stays pure (client-safe: imported by `task-form`); the note snippet plaintext is derived in the server `task-list.tsx` via `plainTextFromHtml`.
6. **Node 26 runs the `.ts` provisioning script natively** (type stripping) with a benign `MODULE_TYPELESS_PACKAGE_JSON` warning; no `tsx` needed. Avoid enums/namespaces/parameter-properties in that script.
7. **PS 5.1** again: git writes push progress to stderr (PowerShell renders it as an error line) — the push still succeeds; check for `main -> main`.

## Rollback Boundary

Revert commits `24ca06e`…`bfc2532`. Schema rollback: `updateEnumAttribute` back to `task,request` (or delete+recreate), delete `bodyHtml`, delete index `created_at`. No bucket/collection was created in this batch (that is PR5). `crm-ge` / `ecotech_sitio_web` and existing buckets untouched. `agenda.tasks` remains empty (probes/creates were not persisted in tests; PR1 only altered schema).

## Next

- **Next recommended**: **apply phases 5–7 (PR5 attachments-schema → PR6 attachments-upload → PR7 attachments-display)**. Extend `scripts/provision-notebook.ts` with the `agenda-attachments` bucket + `attachments` collection (design D3), then the attachment validation/data/flow/route/UI work.
- sdd-verify (after the full slice): live e2e — note create + undated listing + keyword search on note text + XSS render probe; still gated on a real admin password (PR0/PR1 caveat of the archived change).
