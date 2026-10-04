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
