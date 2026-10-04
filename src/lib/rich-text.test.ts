import { describe, expect, it } from 'vitest';
import { plainTextFromHtml, sanitizeNoteHtml } from './rich-text';

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

describe('sanitizeNoteHtml (spec note-capture → Rich-text body and sanitization)', () => {
  it('strips script tags and their content', () => {
    const clean = sanitizeNoteHtml('<p>Hola</p><script>alert(1)</script>');

    expect(clean).toContain('<p>Hola</p>');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
  });

  it('strips inline event handlers such as onerror', () => {
    const clean = sanitizeNoteHtml('<img src="x" onerror="alert(1)">');

    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('alert(1)');
  });

  it('drops javascript: URLs from links', () => {
    const clean = sanitizeNoteHtml('<a href="javascript:alert(1)">x</a>');

    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('x');
  });

  it('preserves bold, lists and headings (formatting round-trip)', () => {
    const clean = sanitizeNoteHtml(
      '<h2>Título</h2><ul><li><strong>Uno</strong> y <em>dos</em></li></ul>',
    );

    expect(clean).toContain('<h2>');
    expect(clean).toContain('<ul>');
    expect(clean).toContain('<li>');
    expect(clean).toContain('<strong>');
    expect(clean).toContain('<em>');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeNoteHtml('')).toBe('');
  });
});
