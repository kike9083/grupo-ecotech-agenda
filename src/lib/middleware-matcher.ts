/**
 * Next.js middleware matcher (design D2 presence gate).
 *
 * `/api/attachments/upload` is deliberately EXCLUDED from the matcher: Next.js
 * 15.5 buffers the request body for any request the middleware runs on, capped
 * at 10 MB by default (`experimental.middlewareClientMaxBodySize`). That cap
 * truncated 10–30 MB uploads and made `request.formData()` throw before the
 * route's own 30 MB validation could return the Spanish "too large" error
 * (verify finding F1). Excluding the route keeps the presence gate on every
 * other path while letting the upload route stream its body; the route still
 * authenticates with `getCurrentUser()`, so authorization is unchanged.
 *
 * `/api/telegram/link` is excluded for a second, independent reason (design
 * D4): the bot's callback carries no `aw_session` cookie, so the gate would
 * redirect it to `/` before the exchange could run. The route self-authenticates
 * with the `x-link-secret` shared secret instead.
 *
 * Kept as a plain module (no `next/server` import) so the matcher contract is
 * unit-testable in the node environment. `src/middleware.ts` inlines the same
 * string (Turbopack cannot statically parse an imported `config.matcher`);
 * `middleware-matcher.test.ts` asserts the literal and this constant stay in
 * sync.
 */
export const MIDDLEWARE_MATCHER = [
  '/((?!_next/static|_next/image|favicon.ico|api/attachments/upload|api/telegram/link|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
] as const;

/**
 * True when the presence gate applies to `pathname`. Mirrors the Next.js
 * matcher semantics for these patterns (the pattern is anchored at both ends,
 * so a leading `/` matches the whole path or nothing).
 */
export function matchesMiddleware(pathname: string): boolean {
  return MIDDLEWARE_MATCHER.some((pattern) =>
    new RegExp(`^${pattern}$`).test(pathname),
  );
}
