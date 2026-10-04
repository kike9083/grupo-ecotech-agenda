# Proposal: agenda-notebook

## Intent

Replace the client's paper notebook with a searchable, dated digital one. The agenda stores only `task|request`; it needs rich-text notes, attachments, a calendar, and date-range lookup. Telegram reminders are slice 2.

## Scope

### In Scope
- `note` type: Tiptap rich text, optional date, `createdAt` ("noted on …"), derived plain text for search.
- Attachments on notes and tasks: Storage bucket + `attachments` collection keyed by generic `recordId`; upload, image gallery, audio player.
- Hand-rolled month calendar; date-range filter (`from`/`to`) on list and search.
- Additive extension of the `tasks` collection.

### Out of Scope
Telegram/reminders/notifications (slice 2), WhatsApp, recurring tasks, edit history, mobile app, permission redesign (both users are admins → visibility already works).

## Capabilities

### New Capabilities
- `note-capture`, `attachments`, `calendar-view`.

### Modified Capabilities
- `task-registration`: `type` enum gains `note`; tasks MAY carry attachments.
- `task-listing`: date-range filter; includes notes.
- `task-search`: covers note text; date-range scoping.

## Approach

Extend `tasks` additively (no required-flag changes): add `note` to `type`, add `bodyHtml`/`bodyText`, derive `searchText`. Tiptap client component; sanitize HTML on render. New `agenda-attachments` bucket (image+audio MIME from precedent buckets, 30 MB, `fileSecurity`) + `attachments` collection; server-only signed URLs; perms mirror the owning record. Calendar is an RSC grid; date filter uses `Query.between('date', …)` on the existing `date_time` index. All Appwrite access stays server-side.

## Split Recommendation

**Split into two changes.** Slice 1 `agenda-notebook` (this). Slice 2 `agenda-reminders` (Telegram): one-time expiring token → `t.me/<bot>?start=<token>` → bot `/start` stores `chatId`; poll scheduler notifies creator only and sets `notified`, behind a `NotificationChannel` seam (WhatsApp later); long-poll `getUpdates` runner in the always-on Next container. Rationale: disjoint risk surfaces; each slice alone far exceeds the 400-line budget; slice 2 depends on slice 1's record model.

## Affected Specs / Domains

| Domain | Impact |
|--------|--------|
| `note-capture`, `attachments`, `calendar-view` | New specs |
| `task-registration`, `task-listing`, `task-search` | Delta specs |
| Appwrite `agenda.tasks` + new bucket/collection | Additive schema + storage |
| `src/lib/{validation/record,rich-text,calendar,appwrite/notes,appwrite/attachments}.ts` | New modules |
| `src/lib/appwrite/tasks.ts`, `src/app/{page,nueva}`, `src/components/*` | Modified/New |
| `package.json` | Tiptap + sanitizer deps |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Live schema change | Med | Additive-only; no required-flag changes; probe |
| Stored rich-text XSS | High | Sanitize on render |
| Attachment visibility leak | Med | Mirror record perms; signed URLs |
| Over 400-line budget | High | Split + chained PRs |
| Tiptap SSR hydration | Med | Client component |

## Rollback Plan

Revert commits; drop the new bucket + `attachments` collection; delete added `tasks` attributes; revert the enum. Existing documents untouched; never touch `crm-ge`/`ecotech_sitio_web`.

## Dependencies

- Appwrite 1.8.1 storage + DB scopes (confirmed); existing session/API-key clients and `searchText` fulltext index.
- Tiptap/ProseMirror + a server-side HTML sanitizer.

## Success Criteria

- [ ] Rich-text note with image + voice note renders "noted on …".
- [ ] Dated note appears on the calendar.
- [ ] Task image/audio attachments render.
- [ ] Date-range filter narrows list and search.
- [ ] Note text findable by keyword; existing behavior/visibility unchanged.

## Preflight

Read `config.yaml` (hybrid, 400-line budget), 5 main specs, archived change artifacts. No blockers. Confirmed: Appwrite 1.8.1, storage scopes, existing `tasks` perms, precedent bucket MIME lists, Easypanel auto-deploy. Assumptions: note title optional; undated notes excluded from calendar; no attachment cap.

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
400-line budget risk: High

Slice 1 ~3,500–5,500 lines; slice 2 ~1,500–2,500. PRs: `notes-schema` → `rich-text-editor` → `attachments` → `calendar-date-filter` → `polish-deploy`. Strategy: auto-forecast.
