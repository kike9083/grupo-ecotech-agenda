import { NextRequest, NextResponse } from 'next/server';
import { AW_SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Edge presence gate (design D2): checks only that the `aw_session` cookie
 * EXISTS — no Appwrite call, no JWT decoding. Identity is resolved later in
 * each RSC via `getCurrentUser()`.
 *
 * `/login` is public; every other route requires a cookie, and cookie carriers
 * are bounced off `/login` back to `/`.
 */
export function middleware(request: NextRequest): NextResponse {
  const hasSession = Boolean(request.cookies.get(AW_SESSION_COOKIE)?.value);
  const isLoginRoute = request.nextUrl.pathname.startsWith('/login');

  if (!hasSession && !isLoginRoute) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hasSession && isLoginRoute) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
