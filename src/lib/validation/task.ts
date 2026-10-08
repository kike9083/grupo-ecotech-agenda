/**
 * Task input validation and record building (specs `task-registration`,
 * `task-search`; design D1).
 *
 * Pure functions only: drafts come in, field errors or a fully populated
 * nine-attribute record come out. Nothing here touches Appwrite — the data
 * layer persists whatever `buildTaskRecord` produces.
 */

export type TaskType = 'task' | 'request' | 'note' | 'event';

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export const TASK_TYPES: readonly TaskType[] = [
  'task',
  'request',
  'note',
  'event',
];

/** Every lifecycle status in transition order (spec task-registration). */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'done',
  'cancelled',
];

export const TITLE_MAX_LENGTH = 200;

export const DESCRIPTION_MAX_LENGTH = 2000;

export const SEARCH_TEXT_MAX_LENGTH = 700;

/** Raw form payload — every field optional so missing input yields errors, not crashes. */
export interface TaskDraft {
  type?: string;
  title?: string;
  description?: string;
  date?: string;
  time?: string;
}

/** Draft after validation: every field present, typed, and normalized. */
export interface ValidatedTaskDraft {
  type: TaskType;
  title: string;
  description: string;
  date: string;
  time: string;
}

export type TaskField = 'type' | 'title' | 'description' | 'date' | 'time';

export type TaskFieldErrors = Partial<Record<TaskField, string>>;

export type TaskValidationResult =
  | { ok: true; value: ValidatedTaskDraft }
  | { ok: false; errors: TaskFieldErrors };

/** Message shown inline next to the offending field (spec `task-registration`). */
const ERROR_MESSAGES = {
  type: 'El tipo de registro no es válido.',
  titleRequired: 'El título es obligatorio.',
  titleTooLong: `El título debe tener como máximo ${TITLE_MAX_LENGTH} caracteres.`,
  descriptionTooLong: `La descripción debe tener como máximo ${DESCRIPTION_MAX_LENGTH} caracteres.`,
  date: 'La fecha debe ser una fecha válida en formato AAAA-MM-DD.',
  time: 'La hora debe ser una hora válida en formato 24 horas (HH:MM).',
} as const;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Real calendar check: 2026-02-30 and 2025-02-29 roll over → rejected. */
export function isRealCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const [, year, month, day] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );

  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
}

/**
 * Validates every field in one pass and collects ALL errors — the form needs
 * each inline message at once (spec `task-registration` → "Invalid input").
 *
 * `description` may be empty (design D1: the form never blocks on it); only
 * its maximum length is enforced. Past dates are valid (backfill scenario).
 */
export function validateTaskDraft(draft: TaskDraft): TaskValidationResult {
  const errors: TaskFieldErrors = {};

  if (draft.type === undefined || !TASK_TYPES.includes(draft.type as TaskType)) {
    errors.type = ERROR_MESSAGES.type;
  }

  const title = (draft.title ?? '').trim();
  if (title.length === 0) {
    errors.title = ERROR_MESSAGES.titleRequired;
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.title = ERROR_MESSAGES.titleTooLong;
  }

  const description = draft.description ?? '';
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = ERROR_MESSAGES.descriptionTooLong;
  }

  const date = draft.date ?? '';
  if (!isRealCalendarDate(date)) {
    errors.date = ERROR_MESSAGES.date;
  }

  const time = draft.time ?? '';
  if (!TIME_PATTERN.test(time)) {
    errors.time = ERROR_MESSAGES.time;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      type: draft.type as TaskType,
      title,
      description,
      date,
      time,
    },
  };
}

/**
 * Fulltext derivation (design D1): `title + " " + description`, cut to the
 * 700-char `searchText` attribute so the index stays under the key-length
 * limit. Matches past the prefix are out of scope by design.
 */
export function buildSearchText(title: string, description: string): string {
  return `${title} ${description}`.slice(0, SEARCH_TEXT_MAX_LENGTH);
}

/** Session identity used for the `createdBy` / `createdByEmail` attributes. */
export interface TaskOwner {
  id: string;
  email: string;
}

/**
 * The attributes stored in the `tasks` collection (design D1). `bodyHtml` is
 * optional and only present on notes (spec `note-capture`); tasks and requests
 * omit it exactly as before.
 */
export interface TaskRecord {
  type: TaskType;
  title: string;
  description: string;
  date: string;
  time: string;
  status: TaskStatus;
  createdBy: string;
  createdByEmail: string;
  searchText: string;
  bodyHtml?: string;
}

/**
 * Server-side defaults for record creation (design D1): status starts at
 * `open` (Appwrite forbids DB defaults on required attributes), ownership
 * comes from the session, `searchText` is derived from the validated draft.
 */
export function buildTaskRecord(
  draft: ValidatedTaskDraft,
  owner: TaskOwner,
): TaskRecord {
  return {
    type: draft.type,
    title: draft.title,
    description: draft.description,
    date: draft.date,
    time: draft.time,
    status: 'open',
    createdBy: owner.id,
    createdByEmail: owner.email,
    searchText: buildSearchText(draft.title, draft.description),
  };
}

/**
 * Attributes an edit may change. `status`, ownership and `bodyHtml` are
 * deliberately absent — the update flow sends this as a PARTIAL payload so an
 * edit can never reset a lifecycle state or rewrite a note body.
 */
export interface EditableTaskRecord {
  type: TaskType;
  title: string;
  description: string;
  date: string;
  time: string;
  searchText: string;
}

/** Partial payload for an edit: the validated draft plus the derived index. */
export function buildTaskUpdate(draft: ValidatedTaskDraft): EditableTaskRecord {
  return {
    type: draft.type,
    title: draft.title,
    description: draft.description,
    date: draft.date,
    time: draft.time,
    searchText: buildSearchText(draft.title, draft.description),
  };
}

/**
 * Status lifecycle matrix (spec `task-registration` → "Status lifecycle"):
 * open → in_progress → done, cancelled allowed from any non-terminal state,
 * done/cancelled are terminal. Self-transitions are not lifecycle moves.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  switch (from) {
    case 'open':
      return to === 'in_progress' || to === 'cancelled';
    case 'in_progress':
      return to === 'done' || to === 'cancelled';
    case 'done':
    case 'cancelled':
      return false;
  }
}
