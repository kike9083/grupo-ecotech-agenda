/**
 * Session cookie contract (design D2).
 *
 * Kept in its own module so the edge middleware can import the cookie name
 * without pulling in server-only code (`next/headers`, `node-appwrite`).
 */

/** httpOnly cookie that carries the Appwrite session secret. */
export const AW_SESSION_COOKIE = 'aw_session';

/** Cookie lifetime in seconds — 24h, per design D2. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
