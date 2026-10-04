import { deleteAttachmentAction } from '@/actions/attachments';
import type { Attachment } from '@/lib/appwrite/attachments';
import { AudioPlayer } from '@/components/audio-player';

/**
 * Attachment gallery (PR7 task 7.3, spec `attachments` → "Attachment display"
 * / "Attachment deletion"): images render as thumbnails and audio as players,
 * both served through the authorized proxy `/api/attachments/<fileId>` — never
 * a public Appwrite URL. Each item carries a delete form wired to the tested
 * `deleteAttachmentAction` (file + metadata both removed). Server component;
 * validated by `tsc`/`next build`.
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
    <ul className="flex flex-wrap items-center gap-2">
      {attachments.map((attachment) => {
        const src = `/api/attachments/${attachment.fileId}`;
        return (
          <li
            key={attachment.$id}
            className="flex flex-col items-start gap-1 rounded-md border border-neutral-200 p-1"
          >
            {attachment.kind === 'image' ? (
              <a href={src} target="_blank" rel="noreferrer">
                <img
                  src={src}
                  alt={attachment.name}
                  className="h-20 w-20 rounded object-cover"
                />
              </a>
            ) : (
              <AudioPlayer fileId={attachment.fileId} name={attachment.name} />
            )}
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
