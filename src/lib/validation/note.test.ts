import { describe, expect, it } from 'vitest';
import { buildNoteRecord, validateNoteDraft } from './note';

const owner = { id: 'user-123', email: 'ana@grupoecotech.com' };

describe('validateNoteDraft (spec note-capture → Note creation)', () => {
  it('accepts a note without a title (title is optional)', () => {
    const result = validateNoteDraft({ bodyHtml: '<p>Acuerdo de octubre</p>' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('note');
      expect(result.value.title).toBe('');
    }
  });

  it('accepts an undated note and keeps the empty-string date sentinel', () => {
    const result = validateNoteDraft({ title: 'Recordatorio' });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'note',
        title: 'Recordatorio',
        bodyHtml: '',
        date: '',
      },
    });
  });

  it('trims the title and keeps a valid date', () => {
    const result = validateNoteDraft({
      title: '  Reunión  ',
      bodyHtml: '<p>Acta</p>',
      date: '2026-10-04',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'note',
        title: 'Reunión',
        bodyHtml: '<p>Acta</p>',
        date: '2026-10-04',
      },
    });
  });

  it('normalizes a missing body to the empty string', () => {
    const result = validateNoteDraft({ title: 'Sin cuerpo' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.bodyHtml).toBe('');
    }
  });

  it('rejects a title over 200 characters with the Spanish message', () => {
    const result = validateNoteDraft({ title: 'a'.repeat(201) });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.title).toBe(
        'El título debe tener como máximo 200 caracteres.',
      );
    }
  });

  it('accepts a 200-character title', () => {
    expect(validateNoteDraft({ title: 'a'.repeat(200) }).ok).toBe(true);
  });

  it('rejects a malformed date that is not YYYY-MM-DD', () => {
    const result = validateNoteDraft({ title: 'Con fecha', date: '04/10/2026' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.date).toBe(
        'La fecha debe ser una fecha válida en formato AAAA-MM-DD.',
      );
    }
  });

  it('rejects a date with no real calendar day (2026-02-30)', () => {
    expect(validateNoteDraft({ date: '2026-02-30' }).ok).toBe(false);
  });
});

describe('buildNoteRecord (design D1 sentinels)', () => {
  it('fills the sentinels and derives searchText from title plus body text', () => {
    const validated = validateNoteDraft({
      title: 'Reunión',
      bodyHtml: '<p>Acuerdo de <strong>octubre</strong></p>',
      date: '2026-10-04',
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(buildNoteRecord(validated.value, owner, 'Acuerdo de octubre')).toEqual({
      type: 'note',
      title: 'Reunión',
      description: '',
      date: '2026-10-04',
      time: '',
      status: 'open',
      createdBy: 'user-123',
      createdByEmail: 'ana@grupoecotech.com',
      bodyHtml: '<p>Acuerdo de <strong>octubre</strong></p>',
      searchText: 'Reunión Acuerdo de octubre',
    });
  });

  it('keeps every sentinel empty for an untitled, undated note', () => {
    const validated = validateNoteDraft({});
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const record = buildNoteRecord(validated.value, owner, '');

    expect(record.title).toBe('');
    expect(record.date).toBe('');
    expect(record.time).toBe('');
    expect(record.description).toBe('');
    expect(record.status).toBe('open');
    expect(record.searchText).toBe(' ');
  });

  it('cuts searchText to the 700-char attribute size', () => {
    const validated = validateNoteDraft({ title: 't'.repeat(200) });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const record = buildNoteRecord(validated.value, owner, 'b'.repeat(600));

    expect(record.searchText).toHaveLength(700);
    expect(record.searchText).toBe('t'.repeat(200) + ' ' + 'b'.repeat(499));
  });
});
