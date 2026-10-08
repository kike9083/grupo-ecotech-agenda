'use client';

import { useState } from 'react';

/**
 * Thumbnail for one image attachment with a hard fallback.
 *
 * Some formats are accepted by the upload matrix but not decodable by every
 * browser (HEIC on desktop Chrome/Firefox, AVIF on older engines). When the
 * bitmap fails to decode the browser paints a broken-image box and gives the
 * user no way to reach the file — so on `error` we swap the whole tile for a
 * labelled link that downloads the original.
 */
export function AttachmentThumbnail({
  src,
  name,
}: {
  src: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded border border-dashed border-hairline bg-surface-sunken px-1 text-center">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5 text-ink-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="w-full truncate text-[0.6rem] text-ink-muted">
          {name}
        </span>
      </span>
    );
  }

  return (
    <a href={src} target="_blank" rel="noreferrer">
      <img
        src={src}
        alt={name}
        onError={() => setFailed(true)}
        className="h-20 w-20 rounded object-cover"
      />
    </a>
  );
}
