import { sanitizeNoteHtml } from '@/lib/rich-text';

/**
 * Renders a stored note body (PR3 task 3.5, spec `note-capture` → "XSS
 * stripped"): the HTML goes through the server-side `sanitizeNoteHtml`
 * whitelist, so `<script>`/handlers never reach the browser. Server component
 * — `sanitize-html` is server-only and must not be bundled for the client.
 */
export function NoteBody({ html }: { html: string }) {
  const clean = sanitizeNoteHtml(html);

  return (
    <div
      className="text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
