import { describe, expect, it } from 'vitest';
import {
  buildAdminHref,
  normalizeSearchTerm,
  parseAdminQuery,
  parseHomeQuery,
} from './search-query';

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
      noted: false,
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
      noted: false,
    });
  });

  it('treats a blank keyword as no search (spec task-search → empty query)', () => {
    expect(parseHomeQuery({ q: '   ' })).toEqual({
      q: '',
      cursor: '',
      searching: false,
      created: false,
      noted: false,
    });
  });

  it('takes the first value when a parameter repeats (Next allows arrays)', () => {
    expect(parseHomeQuery({ q: ['uno', 'dos'], cursor: ['a', 'b'] })).toEqual({
      q: 'uno',
      cursor: 'a',
      searching: true,
      created: false,
      noted: false,
    });
  });

  it('only flags the success banner for the exact created=1 marker', () => {
    expect(parseHomeQuery({ created: '1' }).created).toBe(true);
    expect(parseHomeQuery({ created: '0' }).created).toBe(false);
    expect(parseHomeQuery({ created: 'yes' }).created).toBe(false);
  });

  it('only flags the note banner for the exact noted=1 marker', () => {
    expect(parseHomeQuery({ noted: '1' }).noted).toBe(true);
    expect(parseHomeQuery({ noted: '0' }).noted).toBe(false);
    expect(parseHomeQuery({}).noted).toBe(false);
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

  it('keeps every active filter and the cursor in the next-page link', () => {
    expect(
      buildAdminHref({
        cursor: 'doc-20',
        status: 'open',
        type: 'task',
        creator: 'ana@grupoecotech.com',
      }),
    ).toBe(
      '/admin?status=open&type=task&creator=ana%40grupoecotech.com&cursor=doc-20',
    );
  });

  it('omits the filters that are not set', () => {
    expect(buildAdminHref({ status: 'done' })).toBe('/admin?status=done');
    expect(buildAdminHref({ creator: 'luis@grupoecotech.com' })).toBe(
      '/admin?creator=luis%40grupoecotech.com',
    );
  });
});

describe('parseAdminQuery', () => {
  it('returns neutral defaults when the admin route has no query string', () => {
    expect(parseAdminQuery(undefined)).toEqual({
      cursor: '',
      creator: '',
      filtered: false,
    });
  });

  it('keeps valid filters, the creator and the cursor', () => {
    expect(
      parseAdminQuery({
        status: 'open',
        type: 'request',
        creator: ' ana@grupoecotech.com ',
        cursor: 'doc-9',
      }),
    ).toEqual({
      cursor: 'doc-9',
      status: 'open',
      type: 'request',
      creator: 'ana@grupoecotech.com',
      filtered: true,
    });
  });

  it('drops unknown status and type values instead of trusting them', () => {
    expect(
      parseAdminQuery({ status: 'bogus', type: 'nope', cursor: 'c1' }),
    ).toEqual({ cursor: 'c1', creator: '', filtered: false });
  });

  it('takes the first value when a parameter repeats (Next allows arrays)', () => {
    expect(parseAdminQuery({ status: ['done', 'open'] }).status).toBe('done');
  });

  it('treats a blank creator as no creator filter', () => {
    expect(parseAdminQuery({ creator: '   ' })).toEqual({
      cursor: '',
      creator: '',
      filtered: false,
    });
  });
});
