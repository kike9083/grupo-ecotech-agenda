import { deleteAttachmentAction } from '@/actions/attachments';
import type { Attachment } from '@/lib/appwrite/attachments';
import { AudioPlayer } from '@/components/audio-player';
import { AttachmentThumbnail } from '@/components/attachment-thumbnail';

/**
 * Attachment gallery (PR7 task 7.3, spec `attachments` → "Attachment display"
 * / "Attachment deletion"): images render as thumbnails and audio as players,
 * both served through the authorized proxy `/api/attachments/<fileId>` — never
 * a public Appwrite URL. Each item carries a delete form wired to the tested
 * `deleteAttachmentAction` (file + metadata both removed). Server component;
 * validated by `tsc`/`next build`.
 *
 * Every tile also shows the file NAME as a link: it is the always-visible way
 * back to the original when a format cannot be decoded in place, and it makes
 * "did it attach?" answerable at a glance.
 */
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
            <form action={deleteAttachmentAction}>
              <input
                type="hidden"
                name="documentId"
                value={attachment.$id}
              />
              <button
                type="submit"
                className="text-xs text-red-700 underline"
              >
                Eliminar
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
