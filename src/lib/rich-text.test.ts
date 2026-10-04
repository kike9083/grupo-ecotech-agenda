import { describe, expect, it } from 'vitest';
import { plainTextFromHtml } from './rich-text';

describe('plainTextFromHtml (spec note-capture → Plain-text search index)', () => {
  it('keeps inline text and drops the tags', () => {
    expect(plainTextFromHtml('<p>Acuerdo de <strong>octubre</strong></p>')).toBe(
      'Acuerdo de octubre',
    );
  });

  it('joins block elements with a single space', () => {
    expect(
      plainTextFromHtml('<h1>Título</h1><ul><li>Uno</li><li>Dos</li></ul>'),
    ).toBe('Título Uno Dos');
  });

  it('decodes the common HTML entities', () => {
    expect(plainTextFromHtml('<p>Pan &amp; vino &lt;bueno&gt;</p>')).toBe(
      'Pan & vino <bueno>',
    );
  });

  it('drops script and style content entirely', () => {
    expect(plainTextFromHtml('<script>alert(1)</script>Hola')).toBe('Hola');
    expect(plainTextFromHtml('<style>p{color:red}</style>Texto')).toBe('Texto');
  });

  it('returns an empty string for markup with no text', () => {
    expect(plainTextFromHtml('<p></p>')).toBe('');
    expect(plainTextFromHtml('')).toBe('');
  });
});
