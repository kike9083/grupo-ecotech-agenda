/**
 * Rich-text helpers (spec `note-capture`). This module will become
 * server-only once the sanitizer lands (PR3): it derives the plain text that
 * feeds `searchText` here, and will render the sanitized body.
 */

const ENTITIES: ReadonlyArray<[RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#39;/gi, "'"],
];

/**
 * Derives a plain-text representation of a rich-text body (spec
 * `note-capture` → "Plain-text search index"): script/style blocks are
 * dropped whole, remaining tags become whitespace, common entities are
 * decoded, and runs of whitespace collapse to single spaces.
 */
export function plainTextFromHtml(html: string): string {
  if (html === '') {
    return '';
  }

  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const withoutTags = withoutBlocks.replace(/<[^>]*>/g, ' ');

  const decoded = ENTITIES.reduce(
    (text, [pattern, value]) => text.replace(pattern, value),
    withoutTags,
  );

  return decoded.replace(/\s+/g, ' ').trim();
}
