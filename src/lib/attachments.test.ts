import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_ERROR_MESSAGES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_MB,
  kindFromMime,
  mimeTypeFor,
  validateAttachment,
} from './attachments';

/**
 * RED seam for PR5 task 5.2 (spec `attachments` → "Attachment upload" /
 * "Oversized or wrong type"): the pure size/type matrix the upload route
 * enforces server-side. Fails first because `./attachments` does not exist.
 */
describe('kindFromMime (spec attachments → Attachment upload)', () => {
  it('classifies every accepted image MIME', () => {
    expect(kindFromMime('image/jpeg')).toBe('image');
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('image/webp')).toBe('image');
    expect(kindFromMime('image/heic')).toBe('image');
  });

  it('classifies every accepted audio MIME', () => {
    expect(kindFromMime('audio/webm')).toBe('audio');
    expect(kindFromMime('audio/mpeg')).toBe('audio');
    expect(kindFromMime('audio/wav')).toBe('audio');
    expect(kindFromMime('audio/ogg')).toBe('audio');
    expect(kindFromMime('audio/mp4')).toBe('audio');
    expect(kindFromMime('audio/aac')).toBe('audio');
  });

  it('classifies every accepted document MIME', () => {
    expect(kindFromMime('application/pdf')).toBe('document');
    expect(kindFromMime('application/msword')).toBe('document');
    expect(
      kindFromMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('document');
    expect(kindFromMime('application/vnd.ms-excel')).toBe('document');
    expect(
      kindFromMime(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('document');
  });

  it('ignores MIME parameters and case', () => {
    expect(kindFromMime('audio/webm;codecs=opus')).toBe('audio');
    expect(kindFromMime('IMAGE/PNG')).toBe('image');
  });

  it('rejects anything outside the allow-list', () => {
    expect(kindFromMime('text/plain')).toBeNull();
    expect(kindFromMime('application/zip')).toBeNull();
    expect(kindFromMime('')).toBeNull();
  });
});

describe('mimeTypeFor (extension fallback)', () => {
  it('keeps a recognized MIME as the normalized type', () => {
    expect(mimeTypeFor('photo.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(mimeTypeFor('voice.webm', 'audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('derives the MIME from the extension when the browser sends none', () => {
    expect(mimeTypeFor('photo.heic', '')).toBe('image/heic');
    expect(mimeTypeFor('nota.m4a', '')).toBe('audio/mp4');
    expect(mimeTypeFor('clip.MP3', '')).toBe('audio/mpeg');
    expect(mimeTypeFor('grabacion.wav', '')).toBe('audio/wav');
    expect(mimeTypeFor('informe.pdf', '')).toBe('application/pdf');
    expect(mimeTypeFor('acta.DOCX', '')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(mimeTypeFor('presupuesto.xls', '')).toBe('application/vnd.ms-excel');
  });

  it('falls back to the extension for a generic browser MIME', () => {
    // Legacy .doc/.xls often arrive as application/octet-stream.
    expect(mimeTypeFor('acta.doc', 'application/octet-stream')).toBe(
      'application/msword',
    );
  });

  it('returns null for an unknown extension and no MIME', () => {
    expect(mimeTypeFor('nota.txt', '')).toBeNull();
    expect(mimeTypeFor('sin-extension', '')).toBeNull();
  });
});

describe('validateAttachment (spec attachments → Oversized or wrong type)', () => {
  it('accepts a valid image and reports its kind and MIME', () => {
    expect(
      validateAttachment({ name: 'foto.jpg', type: 'image/jpeg', size: 1024 }),
    ).toEqual({ ok: true, kind: 'image', mimeType: 'image/jpeg' });
  });

  it('accepts a valid voice note', () => {
    expect(
      validateAttachment({ name: 'nota.webm', type: 'audio/webm', size: 2048 }),
    ).toEqual({ ok: true, kind: 'audio', mimeType: 'audio/webm' });
  });

  it('accepts a file exactly at the 30 MB cap', () => {
    expect(
      validateAttachment({
        name: 'grande.png',
        type: 'image/png',
        size: MAX_ATTACHMENT_BYTES,
      }).ok,
    ).toBe(true);
  });

  it('rejects a file one byte over the cap as too-large', () => {
    expect(
      validateAttachment({
        name: 'grande.png',
        type: 'image/png',
        size: MAX_ATTACHMENT_BYTES + 1,
      }),
    ).toEqual({ ok: false, reason: 'too-large' });
  });

  it('accepts a PDF as a document', () => {
    expect(
      validateAttachment({ name: 'doc.pdf', type: 'application/pdf', size: 10 }),
    ).toEqual({ ok: true, kind: 'document', mimeType: 'application/pdf' });
  });

  it('accepts Word and Excel files', () => {
    expect(
      validateAttachment({
        name: 'acta.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 10,
      }),
    ).toEqual({
      ok: true,
      kind: 'document',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(
      validateAttachment({
        name: 'presupuesto.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 10,
      }),
    ).toEqual({
      ok: true,
      kind: 'document',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });

  it('rejects an unsupported MIME with nothing stored', () => {
    expect(
      validateAttachment({ name: 'nota.txt', type: 'text/plain', size: 10 }),
    ).toEqual({ ok: false, reason: 'unsupported-type' });
  });

  it('falls back to the extension when the browser reports no MIME', () => {
    expect(
      validateAttachment({ name: 'foto.heic', type: '', size: 10 }),
    ).toEqual({ ok: true, kind: 'image', mimeType: 'image/heic' });
  });

  it('rejects an oversized file before checking its type', () => {
    expect(
      validateAttachment({ name: 'x.bin', type: '', size: MAX_ATTACHMENT_BYTES + 1 }),
    ).toEqual({ ok: false, reason: 'too-large' });
  });

  it('exposes Spanish copy for both rejection reasons', () => {
    expect(ATTACHMENT_ERROR_MESSAGES['too-large']).toMatch(/demasiado grande/i);
    expect(ATTACHMENT_ERROR_MESSAGES['unsupported-type']).toMatch(/no soportado/i);
  });
});

/**
 * Verify suggestion 3 (cap alignment): the byte cap, the provisioned bucket
 * `maximumFileSize` (30,000,000 — cannot change without re-provisioning) and
 * the user-facing Spanish copy must state the SAME limit. The constant is
 * authoritative; the copy is derived from it so the three cannot drift.
 */
describe('cap alignment (verify suggestion 3 → constant, bucket, copy)', () => {
  it('pins the authoritative cap at the provisioned bucket value', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(30_000_000);
  });

  it('states the cap in MB derived from the byte constant', () => {
    expect(MAX_ATTACHMENT_MB).toBe(MAX_ATTACHMENT_BYTES / 1_000_000);
    expect(MAX_ATTACHMENT_MB).toBe(30);
  });

  it('derives the Spanish too-large copy from the same constant', () => {
    expect(ATTACHMENT_ERROR_MESSAGES['too-large']).toBe(
      `El archivo es demasiado grande (máximo ${MAX_ATTACHMENT_MB} MB).`,
    );
  });
});

/**
 * Judge finding: the file input used to advertise `image/*,audio/*`, which
 * offers gif/bmp/flac — guaranteed `unsupported-type` — while hiding `.heic`,
 * `.m4a` and `.mp4`, which the route accepts. The `accept` attribute is now
 * DERIVED from the same extension keys the validator walks, so the two can
 * never drift apart again.
 */
describe('ATTACHMENT_ACCEPT (picker and validator share one allow-list)', () => {
  it('pins the offered extensions at the bucket allow-list', () => {
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual([
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.heic',
      '.webm',
      '.mp3',
      '.wav',
      '.ogg',
      '.m4a',
      '.mp4',
      '.aac',
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
    ]);
  });

  it('offers only extensions the validator accepts', () => {
    const extensions = ATTACHMENT_ACCEPT.split(',');
    expect(extensions.length).toBeGreaterThan(0);
    for (const entry of extensions) {
      const result = validateAttachment({
        name: `archivo${entry}`,
        type: '',
        size: 1024,
      });
      expect(result.ok, `${entry} debe ser aceptado por el validador`).toBe(true);
    }
  });

  it('never offers a wildcard that the route would reject', () => {
    expect(ATTACHMENT_ACCEPT).not.toMatch(/[*\/]/);
    expect(validateAttachment({ name: 'x.gif', type: 'image/gif', size: 1024 })).toEqual({
      ok: false,
      reason: 'unsupported-type',
    });
  });
});

describe('bucket allow-list (the provisioner cannot drift from the picker)', () => {
  it('pins scripts/provision-notebook.ts at ALLOWED_ATTACHMENT_EXTENSIONS', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../scripts/provision-notebook.ts', import.meta.url)),
      'utf8',
    );
    const block = source.match(/const ALLOWED_EXTENSIONS = \[([\s\S]*?)\];/);

    expect(block, 'ALLOWED_EXTENSIONS must stay a literal in the provisioner').not.toBeNull();
    const bucketList = [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
      (entry) => entry[1],
    );

    expect(bucketList).toEqual([...ALLOWED_ATTACHMENT_EXTENSIONS]);
    expect(bucketList).toHaveLength(ALLOWED_ATTACHMENT_EXTENSIONS.length);
  });
});
