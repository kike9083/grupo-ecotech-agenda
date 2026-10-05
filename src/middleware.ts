import { NextRequest, NextResponse } from 'next/server';
import { AW_SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Edge presence gate (design D2): checks only that the `aw_session` cookie
 * EXISTS — no Appwrite call, no JWT decoding. Identity is resolved later in
 * each RSC via `getCurrentUser()`.
 *
 * `/login` is public; every other route requires a cookie, and cookie carriers
 * are bounced off `/login` back to `/`.
 *
 * Expired-session escape hatch: an RSC cannot mutate cookies (Next.js
 * restriction), so it redirects to `/login?error=expired`; middleware then
 * clears the stale cookie and serves the login page — a presence-only rule
 * that terminates the otherwise infinite `/` ↔ `/login` bounce.
 */
export function middleware(request: NextRequest): NextResponse {
  const hasSession = Boolean(request.cookies.get(AW_SESSION_COOKIE)?.value);
  const isLoginRoute = request.nextUrl.pathname.startsWith('/login');
  const sessionExpired =
    isLoginRoute && request.nextUrl.searchParams.get('error') === 'expired';

  if (sessionExpired && hasSession) {
    const response = NextResponse.next();
    response.cookies.delete(AW_SESSION_COOKIE);
    return response;
  }

  if (!hasSession && !isLoginRoute) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hasSession && isLoginRoute) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

/**
 * Turbopack can only statically parse a LITERAL `matcher` (an imported
 * constant or spread breaks the build with "Invalid segment configuration"),
 * so the pattern is inlined here. `src/lib/middleware-matcher.ts` holds the
 * same string as `MIDDLEWARE_MATCHER` plus the testable `matchesMiddleware`
 * seam, and `middleware-matcher.test.ts` asserts the two never drift.
 *
 * `/api/attachments/upload` is excluded so Next.js does not buffer its body
 * at the 10 MB middleware cap (verify F1); `/api/telegram/link` is excluded
 * because the bot callback has no `aw_session` cookie and the route
 * self-authenticates with the `x-link-secret` shared secret (design D4).
 * Every other route keeps the presence gate, and the upload route
 * authenticates itself via `getCurrentUser()` (401 when the session is
 * missing).
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/attachments/upload|api/telegram/link|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
