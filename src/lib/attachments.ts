/**
 * Attachment validation (PR5 task 5.3, spec `attachments` → "Attachment
 * upload"). Pure functions only: the upload route and the attachment flow
 * share this size/type matrix, and nothing here touches Appwrite or Storage.
 *
 * The accepted set mirrors the `agenda-attachments` bucket's
 * `allowedFileExtensions` allow-list (server-side, so both must move
 * together): images `jpeg/png/webp/heic`, audio
 * `webm/mp3/wav/ogg/m4a/mp4/aac`, documents `pdf/doc/docx/xls/xlsx`.
 */

export type AttachmentKind = 'image' | 'audio' | 'document';

export type AttachmentRejectionReason = 'too-large' | 'unsupported-type';

/**
 * Appwrite's 30 MB cap, matching the provisioned bucket's `maximumFileSize`
 * (30,000,000 — verify suggestion 3 decision: the decimal constant is
 * authoritative over design D3's earlier 31,457,280/30 MiB figure, so the
 * constant, the bucket and the Spanish copy all state the same limit).
 */
export const MAX_ATTACHMENT_BYTES = 30000000;

/** Cap in MB, derived so the user-facing copy cannot drift from the constant. */
export const MAX_ATTACHMENT_MB = MAX_ATTACHMENT_BYTES / 1_000_000;

const IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

const AUDIO_MIME = [
  'audio/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
] as const;

const DOCUMENT_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/** Extension → canonical MIME, used when the browser reports no/unknown type. */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * The `accept` attribute for the file input, DERIVED from the same extension
 * keys the server validates against: the picker can neither offer a type that
 * the route rejects (gif/bmp/flac via `image/*`) nor hide one it accepts
 * (heic/m4a/mp4). `image/*`/`audio/*` wildcards are deliberately avoided.
 */
export const ATTACHMENT_ACCEPT: string = Object.keys(EXTENSION_MIME)
  .map((extension) => `.${extension}`)
  .join(',');

/** Spanish copy shown inline by the upload form (spec → "inline Spanish error"). */
export const ATTACHMENT_ERROR_MESSAGES: Record<AttachmentRejectionReason, string> = {
  'too-large': `El archivo es demasiado grande (máximo ${MAX_ATTACHMENT_MB} MB).`,
  'unsupported-type': 'Tipo de archivo no soportado.',
};

/** Normalizes a raw MIME: drops parameters (`;codecs=…`) and lowercases it. */
function normalizeMime(type: string): string {
  return type.split(';')[0].trim().toLowerCase();
}

/** Classifies an accepted MIME as image/audio/document, or null when unsupported. */
export function kindFromMime(mimeType: string): AttachmentKind | null {
  const mime = normalizeMime(mimeType);
  if ((IMAGE_MIME as readonly string[]).includes(mime)) {
    return 'image';
  }
  if ((AUDIO_MIME as readonly string[]).includes(mime)) {
    return 'audio';
  }
  if ((DOCUMENT_MIME as readonly string[]).includes(mime)) {
    return 'document';
  }
  return null;
}

/** Lowercased extension of a filename, or '' when it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) {
    return '';
  }
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Resolves the canonical MIME for a candidate: a recognized `type` wins,
 * otherwise the filename extension is used (browsers often send an empty
 * `type` for HEIC). Returns null when neither is in the allow-list.
 */
export function mimeTypeFor(name: string, type: string): string | null {
  const normalized = normalizeMime(type);
  if (kindFromMime(normalized) !== null) {
    return normalized;
  }
  return EXTENSION_MIME[extensionOf(name)] ?? null;
}

/** Raw file metadata the browser sends with a multipart upload. */
export interface AttachmentCandidate {
  name: string;
  type: string;
  size: number;
}

export type AttachmentValidationResult =
  | { ok: true; kind: AttachmentKind; mimeType: string }
  | { ok: false; reason: AttachmentRejectionReason };

/**
 * Size then type: a file over the cap is `too-large` regardless of its type,
 * and anything whose MIME/extension is not in the allow-list is
 * `unsupported-type`. Both mean "nothing is stored" (spec → "Oversized or
 * wrong type").
 */
export function validateAttachment(
  candidate: AttachmentCandidate,
): AttachmentValidationResult {
  if (candidate.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  const mimeType = mimeTypeFor(candidate.name, candidate.type);
  if (mimeType === null) {
    return { ok: false, reason: 'unsupported-type' };
  }

  const kind = kindFromMime(mimeType);
  if (kind === null) {
    return { ok: false, reason: 'unsupported-type' };
  }

  return { ok: true, kind, mimeType };
}
