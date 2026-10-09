/**
 * Note input validation and record building (spec `note-capture`, design D1).
 *
 * Notes are `tasks` records of type `note`: the required task attributes are
 * filled with sentinels — `description`/`time` are always `''`, `status` is an
 * inert `open` — while the note content lives in the optional `bodyHtml`
 * attribute and the derived `searchText` (title + plain body text).
 *
 * Pure functions only: nothing here touches Appwrite. The plain text of the
 * body is derived by the caller (`plainTextFromHtml`, rich-text module) so
 * this module stays importable from client components.
 */

import {
  buildSearchText,
  isRealCalendarDate,
  type TaskOwner,
} from '@/lib/validation/task';

export const NOTE_TITLE_MAX_LENGTH = 200;

/** Raw note form payload — every field optional so gaps become sentinels. */
export interface NoteDraft {
  title?: string;
  bodyHtml?: string;
  date?: string;
}

/** Draft after validation: every field present, typed, and normalized. */
export interface ValidatedNoteDraft {
  type: 'note';
  title: string;
  bodyHtml: string;
  date: string;
}

export type NoteField = 'title' | 'date';

export type NoteFieldErrors = Partial<Record<NoteField, string>>;

export type NoteValidationResult =
  | { ok: true; value: ValidatedNoteDraft }
  | { ok: false; errors: NoteFieldErrors };

/** Message shown inline next to the offending field (Spanish UI copy). */
const ERROR_MESSAGES = {
  titleTooLong: `El título debe tener como máximo ${NOTE_TITLE_MAX_LENGTH} caracteres.`,
  date: 'La fecha debe ser una fecha válida en formato AAAA-MM-DD.',
} as const;

/**
 * Validates a note draft. Title and date are optional (spec `note-capture` →
 * "Note creation"): an absent title becomes `''`, an absent date becomes the
 * `''` sentinel that keeps the note out of the calendar. A malformed or
 * impossible date is rejected. `bodyHtml` is normalized to a trimmed string.
 */
export function validateNoteDraft(draft: NoteDraft): NoteValidationResult {
  const errors: NoteFieldErrors = {};

  const title = (draft.title ?? '').trim();
  if (title.length > NOTE_TITLE_MAX_LENGTH) {
    errors.title = ERROR_MESSAGES.titleTooLong;
  }

  const rawDate = (draft.date ?? '').trim();
  if (rawDate !== '' && !isRealCalendarDate(rawDate)) {
    errors.date = ERROR_MESSAGES.date;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      type: 'note',
      title,
      bodyHtml: (draft.bodyHtml ?? '').trim(),
      date: rawDate,
    },
  };
}

/** The stored `tasks` shape for a note (design D1). */
export interface NoteRecord {
  type: 'note';
  title: string;
  description: string;
  date: string;
  time: string;
  status: 'open';
  createdBy: string;
  createdByEmail: string;
  bodyHtml: string;
  searchText: string;
}

/**
 * Builds the stored record from a validated note draft: sentinels for the
 * unused task attributes and `searchText` derived from the title plus the
 * plain text of the body (truncated to the 700-char attribute by
 * `buildSearchText`). `bodyText` comes from `plainTextFromHtml`.
 */
export function buildNoteRecord(
  draft: ValidatedNoteDraft,
  owner: TaskOwner,
  bodyText: string,
): NoteRecord {
  return {
    type: 'note',
    title: draft.title,
    description: '',
    date: draft.date,
    time: '',
    status: 'open',
    createdBy: owner.id,
    createdByEmail: owner.email,
    bodyHtml: draft.bodyHtml,
    searchText: buildSearchText(draft.title, bodyText),
  };
}

/**
 * Attributes a note edit may change. Mirrors `EditableTaskRecord` but carries
 * the body, which only notes have — `updateTask` deliberately cannot send it,
 * so the two write paths stay separate instead of widening one to fit both.
 * `type`, ownership and `status` are absent for the same reason.
 */
export interface EditableNoteRecord {
  title: string;
  date: string;
  bodyHtml: string;
  searchText: string;
}

/**
 * Partial payload for a note edit: the validated draft plus the derived index.
 * `searchText` is rebuilt from the title AND the plain body text exactly like
 * `buildNoteRecord`, so an edited note keeps its content searchable — routing
 * a note through the task path would index the description instead and drop
 * the body from search.
 */
export function buildNoteUpdate(
  draft: ValidatedNoteDraft,
  bodyText: string,
): EditableNoteRecord {
  return {
    title: draft.title,
    date: draft.date,
    bodyHtml: draft.bodyHtml,
    searchText: buildSearchText(draft.title, bodyText),
  };
}
