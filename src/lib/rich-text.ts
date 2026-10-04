import sanitizeHtml from 'sanitize-html';

/**
 * Rich-text helpers (spec `note-capture`). SERVER-ONLY: `sanitize-html` must
 * never reach the client bundle. `plainTextFromHtml` derives the text that
 * feeds `searchText`; `sanitizeNoteHtml` renders the stored body safely.
 */

/**
 * Whitelist for note bodies: the Tiptap starter-kit formatting set only.
 * `sanitize-html` strips `<script>` (with its content), inline event handlers
 * (`onerror`, …) and non-`http(s)`/`mailto` URLs by default.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'strike',
    'h1',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'a',
    'hr',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    p: ['style'],
    span: ['style'],
    h1: ['style'],
    h2: ['style'],
    h3: ['style'],
    h4: ['style'],
    li: ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

/**
 * Renders a stored note body safely (spec `note-capture` → "XSS stripped"):
 * the formatting whitelist survives, everything executable is removed.
 */
export function sanitizeNoteHtml(html: string): string {
  if (html === '') {
    return '';
  }
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

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
