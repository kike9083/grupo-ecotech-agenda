import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIDDLEWARE_MATCHER, matchesMiddleware } from './middleware-matcher';

/**
 * RED seam for verify finding F1 (spec `attachments` → "Attachment upload"):
 * the `agenda-attachments` upload route must be excluded from the middleware
 * matcher, otherwise Next.js 15.5 buffers the request body at its 10 MB
 * middleware cap and `request.formData()` dies before the app's own 30 MB
 * validation can return the Spanish "too large" error.
 */
describe('middleware matcher (verify F1 — attachment upload body limit)', () => {
  it('excludes the attachment upload route so Next does not buffer its body', () => {
    expect(matchesMiddleware('/api/attachments/upload')).toBe(false);
  });

  it('still gates the app routes and the attachment proxy', () => {
    expect(matchesMiddleware('/')).toBe(true);
    expect(matchesMiddleware('/nota')).toBe(true);
    expect(matchesMiddleware('/api/attachments/abc123')).toBe(true);
  });

  it('keeps the static-asset exclusions', () => {
    expect(matchesMiddleware('/_next/static/chunk.js')).toBe(false);
    expect(matchesMiddleware('/_next/image')).toBe(false);
    expect(matchesMiddleware('/favicon.ico')).toBe(false);
    expect(matchesMiddleware('/logo.png')).toBe(false);
  });

  it('keeps the literal in src/middleware.ts in sync with the seam', () => {
    // Turbopack cannot statically parse an imported `config.matcher`, so
    // `src/middleware.ts` inlines the pattern; this guard fails whenever the
    // two copies drift apart.
    const source = readFileSync(
      new URL('../middleware.ts', import.meta.url),
      'utf8',
    );
    const sourceForm = MIDDLEWARE_MATCHER[0].replace(/\\/g, '\\\\');
    expect(source).toContain(`'${sourceForm}'`);
  });
});
