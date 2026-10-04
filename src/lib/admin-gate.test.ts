import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveAdminAccess } from './admin-gate';

describe('resolveAdminAccess (spec agenda-auth → Admin role detection)', () => {
  it('lets a signed-in member of the admins team through', () => {
    expect(resolveAdminAccess({ id: 'admin-1' }, true)).toEqual({
      kind: 'allow',
    });
  });

  it('denies a signed-in non-admin with forbidden (spec record-visibility → peer isolation: no data)', () => {
    expect(resolveAdminAccess({ id: 'user-1' }, false)).toEqual({
      kind: 'forbidden',
    });
  });

  it('reports a missing session before any role check', () => {
    expect(resolveAdminAccess(null, false)).toEqual({ kind: 'session' });
    expect(resolveAdminAccess(null, true)).toEqual({ kind: 'session' });
  });
});

describe('admin route streaming boundary (verify fix F2)', () => {
  it('keeps route-level loading boundaries off the paths that flush before the admin gate', () => {
    // A loading boundary flushes the streaming shell (status 200 committed)
    // before the page's resolveAdminAccess → notFound() runs, so member
    // GET /admin answered 200 with 404 content. The admin segment's own
    // loading.tsx AND the root loading.tsx (whose Suspense wraps every child
    // route — empirically the actual flusher: 200 with it, 404 without)
    // must stay absent; the home route keeps its loading UX through a
    // co-located <Suspense> instead. Without a boundary the gate is the
    // first thing that renders and the true 404 reaches the wire.
    const rootLoading = fileURLToPath(
      new URL('../app/loading.tsx', import.meta.url),
    );
    const adminLoading = fileURLToPath(
      new URL('../app/admin/loading.tsx', import.meta.url),
    );
    expect(existsSync(rootLoading)).toBe(false);
    expect(existsSync(adminLoading)).toBe(false);
  });
});
