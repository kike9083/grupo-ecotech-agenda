import { describe, expect, it } from 'vitest';
import {
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

  it('ignores MIME parameters and case', () => {
    expect(kindFromMime('audio/webm;codecs=opus')).toBe('audio');
    expect(kindFromMime('IMAGE/PNG')).toBe('image');
  });

  it('rejects anything outside the allow-list', () => {
    expect(kindFromMime('text/plain')).toBeNull();
    expect(kindFromMime('application/pdf')).toBeNull();
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
  });

  it('returns null for an unknown extension and no MIME', () => {
    expect(mimeTypeFor('documento.pdf', '')).toBeNull();
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

  it('rejects an unsupported MIME with nothing stored', () => {
    expect(
      validateAttachment({ name: 'doc.pdf', type: 'application/pdf', size: 10 }),
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
