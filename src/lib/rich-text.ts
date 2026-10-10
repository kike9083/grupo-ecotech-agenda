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
 *
 * `style` is deliberately NOT allowed: `sanitize-html` passes CSS verbatim, so
 * an inline style could carry `position:fixed` overlays or `url()` trackers
 * that `NoteBody` would then render through `dangerouslySetInnerHTML`.
 * StarterKit never emits inline styles, so only pasted styled markup loses
 * its decoration.
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

/**
 * Normalizes a stored note body: Tiptap emits `<p></p>` for a document the
 * user has cleared, which is not "empty" for `resolveNoteBodyState` — the
 * list would render a blank content block instead of the empty state. Writing
 * `''` keeps the stored value canonical from the first save onward.
 */
export function normalizeNoteBodyHtml(html: string): string {
  return plainTextFromHtml(html) === '' ? '' : html;
}
