import type { Attachment } from '@/lib/appwrite/attachments';
import { AudioPlayer } from '@/components/audio-player';
import { AttachmentThumbnail } from '@/components/attachment-thumbnail';
import { DeleteAttachmentButton } from '@/components/delete-attachment-button';

/**
 * Attachment gallery (PR7 task 7.3, spec `attachments` → "Attachment display"
 * / "Attachment deletion"): images render as thumbnails, audio as players and
 * documents (pdf/doc/docx/xls/xlsx) as a file chip, all served through the
 * authorized proxy `/api/attachments/<fileId>` — never a public Appwrite URL.
 * Each item carries a delete control wired to the tested
 * `deleteAttachmentAction` (file + metadata both removed); it lives in its own
 * client component so a failed deletion can show its Spanish reason inline.
 * Server component; validated by `tsc`/`next build`.
 *
 * Every tile also shows the file NAME as a link: it is the always-visible way
 * back to the original when a format cannot be decoded in place, and it makes
 * "did it attach?" answerable at a glance.
 */
function documentLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return 'archivo';
  }
  return name.slice(dot + 1).toLowerCase();
}
export function AttachmentGallery({
  attachments,
}: {
  attachments: Attachment[];
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap items-end gap-2">
      {attachments.map((attachment) => {
        const src = `/api/attachments/${attachment.fileId}`;
        return (
          <li
            key={attachment.$id}
            className="flex max-w-32 flex-col items-start gap-1 rounded-lg border border-hairline bg-surface p-1"
          >
            {attachment.kind === 'image' ? (
              <AttachmentThumbnail src={src} name={attachment.name} />
            ) : attachment.kind === 'audio' ? (
              <AudioPlayer fileId={attachment.fileId} name={attachment.name} />
            ) : attachment.kind === 'document' ? (
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded border border-hairline bg-surface-sunken px-1 text-center"
                title={attachment.name}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-6 w-6 text-ink-muted"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14 3v5h5"
                  />
                </svg>
                <span className="text-[0.6rem] font-bold uppercase tracking-wider text-ink-muted">
                  {documentLabel(attachment.name)}
                </span>
              </a>
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded border border-hairline bg-surface-sunken text-xs font-semibold text-ink-muted">
                Archivo
              </span>
            )}
            <a
              href={src}
              download={attachment.name}
              className="max-w-full truncate text-xs text-accent-ink underline"
              title={attachment.name}
            >
              {attachment.name}
            </a>
            <DeleteAttachmentButton documentId={attachment.$id} />
          </li>
        );
      })}
    </ul>
  );
}
