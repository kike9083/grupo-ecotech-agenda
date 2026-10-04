import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const requestTo = (path: string, cookie?: string): NextRequest =>
  new NextRequest(`http://localhost${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });

describe('middleware presence gate', () => {
  it('redirects an anonymous visitor on a protected route to /login', () => {
    const response = middleware(requestTo('/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('redirects an anonymous visitor on nested protected routes too', () => {
    const response = middleware(requestTo('/nueva'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('gates /admin behind the session like every other non-static route (PR4)', () => {
    const response = middleware(requestTo('/admin'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('lets a cookie carrier reach /admin — the page gate enforces the role', () => {
    const response = middleware(requestTo('/admin', 'aw_session=secret-value'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets an anonymous visitor through to /login', () => {
    const response = middleware(requestTo('/login'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets a visitor carrying the aw_session cookie reach protected routes', () => {
    const response = middleware(requestTo('/', 'aw_session=secret-value'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects a cookie-carrying visitor away from /login to /', () => {
    const response = middleware(requestTo('/login', 'aw_session=secret-value'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/');
  });

  it('treats an empty aw_session value as no session', () => {
    const response = middleware(requestTo('/', 'aw_session='));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });

  it('clears a stale cookie and serves /login when the session expired marker arrives', () => {
    const response = middleware(requestTo('/login?error=expired', 'aw_session=stale'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('aw_session=;');
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('does not touch cookies when /login?error=expired arrives without a cookie', () => {
    const response = middleware(requestTo('/login?error=expired'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('still bounces a cookie carrier away from /login for non-expired errors', () => {
    const response = middleware(requestTo('/login?error=credentials', 'aw_session=stale'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/');
  });
});
