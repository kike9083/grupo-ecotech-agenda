import { describe, expect, it } from 'vitest';
import {
  NOTE_EMPTY_MESSAGE,
  NOTE_LOADING_LABEL,
  NOTE_LOAD_ERROR_MESSAGE,
  NOTE_RETRY_LABEL,
  resolveNoteBodyState,
} from './note-ui-states';

describe('note UI state copy (spec note-capture → Note UI states)', () => {
  it('keeps the empty, loading and error copy in Spanish', () => {
    expect(NOTE_EMPTY_MESSAGE).toBe('Esta nota no tiene contenido.');
    expect(NOTE_LOADING_LABEL).toBe('Cargando nota…');
    expect(NOTE_LOAD_ERROR_MESSAGE).toBe(
      'No se pudo cargar la nota. Intenta de nuevo más tarde.',
    );
    expect(NOTE_RETRY_LABEL).toBe('Reintentar');
  });
});

describe('resolveNoteBodyState', () => {
  it('flags an absent or blank body as empty', () => {
    expect(resolveNoteBodyState(undefined)).toBe('empty');
    expect(resolveNoteBodyState('')).toBe('empty');
    expect(resolveNoteBodyState('   ')).toBe('empty');
  });

  it('flags a stored body as content', () => {
    expect(resolveNoteBodyState('<p>Acta</p>')).toBe('content');
  });
});
