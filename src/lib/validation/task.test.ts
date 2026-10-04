import { describe, expect, it } from 'vitest';
import {
  buildSearchText,
  buildTaskRecord,
  canTransition,
  validateTaskDraft,
} from './task';

const validDraft = {
  type: 'task',
  title: 'Prepare invoice',
  description: 'Send the October invoice to the client',
  date: '2026-10-05',
  time: '09:30',
};

const owner = { id: 'user-123', email: 'owner@example.com' };

describe('validateTaskDraft', () => {
  it('accepts a valid draft and returns the normalized value', () => {
    const result = validateTaskDraft(validDraft);

    expect(result).toEqual({ ok: true, value: validDraft });
  });

  it('trims surrounding whitespace from the title', () => {
    const result = validateTaskDraft({ ...validDraft, title: '  Pay bills  ' });

    expect(result).toEqual({
      ok: true,
      value: { ...validDraft, title: 'Pay bills' },
    });
  });

  it('rejects a type outside the task|request enum', () => {
    const result = validateTaskDraft({ ...validDraft, type: 'note' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.type).toBe('Type must be "task" or "request".');
    }
  });

  it('rejects a missing type', () => {
    const result = validateTaskDraft({ ...validDraft, type: undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.type).toBeDefined();
    }
  });

  it('rejects an empty title', () => {
    const result = validateTaskDraft({ ...validDraft, title: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.title).toBe('Title is required.');
    }
  });

  it('rejects a malformed date that is not YYYY-MM-DD', () => {
    const result = validateTaskDraft({ ...validDraft, date: '05/10/2026' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.date).toBe(
        'Date must be a valid date in YYYY-MM-DD format.',
      );
    }
  });

  it('rejects a date that has no real calendar day (2026-02-30)', () => {
    const result = validateTaskDraft({ ...validDraft, date: '2026-02-30' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.date).toBe(
        'Date must be a valid date in YYYY-MM-DD format.',
      );
    }
  });

  it('accepts a past date unchanged (backfill scenario)', () => {
    const result = validateTaskDraft({ ...validDraft, date: '2020-01-15' });

    expect(result).toEqual({
      ok: true,
      value: { ...validDraft, date: '2020-01-15' },
    });
  });

  it('rejects a time outside the 00:00-23:59 range', () => {
    const result = validateTaskDraft({ ...validDraft, time: '24:00' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.time).toBe(
        'Time must be a valid 24-hour time in HH:mm format.',
      );
    }
  });

  it('collects every field error in a single pass', () => {
    const result = validateTaskDraft({
      type: 'note',
      title: '',
      description: '',
      date: '2026-13-01',
      time: '9:00',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        'date',
        'time',
        'title',
        'type',
      ]);
    }
  });

  it('accepts a 200-character title and rejects 201', () => {
    const longTitle = 'a'.repeat(200);

    expect(validateTaskDraft({ ...validDraft, title: longTitle }).ok).toBe(
      true,
    );

    const tooLong = validateTaskDraft({ ...validDraft, title: 'a'.repeat(201) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.errors.title).toBe(
        'Title must be at most 200 characters.',
      );
    }
  });

  it('accepts an empty description but rejects one over 2000 chars', () => {
    expect(
      validateTaskDraft({ ...validDraft, description: '' }),
    ).toMatchObject({ ok: true });

    const tooLong = validateTaskDraft({
      ...validDraft,
      description: 'a'.repeat(2001),
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.errors.description).toBe(
        'Description must be at most 2000 characters.',
      );
    }

    expect(
      validateTaskDraft({ ...validDraft, description: 'a'.repeat(2000) }).ok,
    ).toBe(true);
  });

  it('accepts Feb 29 only in leap years', () => {
    expect(validateTaskDraft({ ...validDraft, date: '2024-02-29' }).ok).toBe(
      true,
    );
    expect(validateTaskDraft({ ...validDraft, date: '2025-02-29' }).ok).toBe(
      false,
    );
  });

  it('accepts the 00:00 and 23:59 boundaries, rejects non-padded or impossible times', () => {
    expect(validateTaskDraft({ ...validDraft, time: '00:00' }).ok).toBe(true);
    expect(validateTaskDraft({ ...validDraft, time: '23:59' }).ok).toBe(true);
    expect(validateTaskDraft({ ...validDraft, time: '12:60' }).ok).toBe(false);
    expect(validateTaskDraft({ ...validDraft, time: '9:00' }).ok).toBe(false);
  });

  it('accepts type "request" as a first-class enum member', () => {
    const result = validateTaskDraft({ ...validDraft, type: 'request' });

    expect(result).toEqual({
      ok: true,
      value: { ...validDraft, type: 'request' },
    });
  });
});

describe('buildSearchText', () => {
  it('concatenates title and description with a single space (design D1)', () => {
    expect(buildSearchText('Prepare invoice', 'Send it in October')).toBe(
      'Prepare invoice Send it in October',
    );
  });

  it('keeps an empty description as a trailing space', () => {
    expect(buildSearchText('Prepare invoice', '')).toBe('Prepare invoice ');
  });

  it('cuts the prefix to the 700-char searchText attribute size', () => {
    const title = 't'.repeat(500);
    const description = 'd'.repeat(500);

    const searchText = buildSearchText(title, description);

    expect(searchText).toHaveLength(700);
    expect(searchText).toBe('t'.repeat(500) + ' ' + 'd'.repeat(199));
  });
});

describe('buildTaskRecord', () => {
  it('fills all nine attributes with server-side defaults (design D1)', () => {
    const validated = validateTaskDraft(validDraft);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(buildTaskRecord(validated.value, owner)).toEqual({
      type: 'task',
      title: 'Prepare invoice',
      description: 'Send the October invoice to the client',
      date: '2026-10-05',
      time: '09:30',
      status: 'open',
      createdBy: 'user-123',
      createdByEmail: 'owner@example.com',
      searchText: 'Prepare invoice Send the October invoice to the client',
    });
  });
});

describe('canTransition (status matrix, spec task-registration)', () => {
  it('allows open → in_progress and open → cancelled', () => {
    expect(canTransition('open', 'in_progress')).toBe(true);
    expect(canTransition('open', 'cancelled')).toBe(true);
  });

  it('blocks open → done (must pass through in_progress)', () => {
    expect(canTransition('open', 'done')).toBe(false);
  });

  it('allows in_progress → done and in_progress → cancelled', () => {
    expect(canTransition('in_progress', 'done')).toBe(true);
    expect(canTransition('in_progress', 'cancelled')).toBe(true);
  });

  it('blocks going backwards from in_progress to open', () => {
    expect(canTransition('in_progress', 'open')).toBe(false);
  });

  it('treats done and cancelled as terminal (no exits, no self-loops)', () => {
    expect(canTransition('done', 'open')).toBe(false);
    expect(canTransition('done', 'in_progress')).toBe(false);
    expect(canTransition('cancelled', 'in_progress')).toBe(false);
    expect(canTransition('cancelled', 'done')).toBe(false);
    expect(canTransition('done', 'done')).toBe(false);
    expect(canTransition('cancelled', 'cancelled')).toBe(false);
  });

  it('does not count a self-transition on open as a lifecycle move', () => {
    expect(canTransition('open', 'open')).toBe(false);
  });
});
