import { describe, expect, it } from 'vitest';
import { buildAdminHref, normalizeSearchTerm, parseHomeQuery } from './search-query';

describe('normalizeSearchTerm', () => {
  it('trims surrounding whitespace and collapses inner runs', () => {
    expect(normalizeSearchTerm('  pago   factura ')).toBe('pago factura');
  });

  it('reduces a whitespace-only term to the empty string', () => {
    expect(normalizeSearchTerm('   \t  ')).toBe('');
  });

  it('leaves a single word untouched', () => {
    expect(normalizeSearchTerm('pago')).toBe('pago');
  });
});

describe('parseHomeQuery', () => {
  it('returns neutral defaults when the route has no query string', () => {
    expect(parseHomeQuery(undefined)).toEqual({
      q: '',
      cursor: '',
      searching: false,
      created: false,
    });
  });

  it('normalizes the keyword and carries the cursor', () => {
    expect(
      parseHomeQuery({ q: '  pago ', cursor: ' doc-20 ', created: '1' }),
    ).toEqual({
      q: 'pago',
      cursor: 'doc-20',
      searching: true,
      created: true,
    });
  });

  it('treats a blank keyword as no search (spec task-search → empty query)', () => {
    expect(parseHomeQuery({ q: '   ' })).toEqual({
      q: '',
      cursor: '',
      searching: false,
      created: false,
    });
  });

  it('takes the first value when a parameter repeats (Next allows arrays)', () => {
    expect(parseHomeQuery({ q: ['uno', 'dos'], cursor: ['a', 'b'] })).toEqual({
      q: 'uno',
      cursor: 'a',
      searching: true,
      created: false,
    });
  });

  it('only flags the success banner for the exact created=1 marker', () => {
    expect(parseHomeQuery({ created: '1' }).created).toBe(true);
    expect(parseHomeQuery({ created: '0' }).created).toBe(false);
    expect(parseHomeQuery({ created: 'yes' }).created).toBe(false);
  });
});

describe('buildAdminHref', () => {
  it('builds the admin next-page link from the cursor', () => {
    expect(buildAdminHref({ cursor: 'doc-20' })).toBe('/admin?cursor=doc-20');
  });

  it('falls back to the bare admin route when there is nothing to carry', () => {
    expect(buildAdminHref({})).toBe('/admin');
    expect(buildAdminHref({ cursor: '' })).toBe('/admin');
  });
});
