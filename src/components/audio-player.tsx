/**
 * Audio attachment player (PR7 task 7.3, spec `attachments` → "Attachment
 * display"): a native `<audio>` element whose source is the authorized proxy —
 * the browser never receives an Appwrite URL. Server component (no client
 * state needed).
 */
export function AudioPlayer({ fileId, name }: { fileId: string; name: string }) {
  return (
    <audio
      controls
      src={`/api/attachments/${fileId}`}
      aria-label={name}
      className="h-9 w-56"
    />
  );
}
