import { cache } from 'react';
import { cookies } from 'next/headers';
import { Account, Teams } from 'node-appwrite';
import { loadEnv } from '@/lib/env';
import { createSessionClient } from './clients';
import { AW_SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '../session-cookie';

export { AW_SESSION_COOKIE, SESSION_MAX_AGE_SECONDS };

/** Cookie attributes for the `aw_session` secret (design D2). */
export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

export interface SessionUser {
  id: string;
  email: string;
}

/** Minimal structural view of `Account` so tests can inject a fake (design D5). */
export interface AccountLike {
  get(): Promise<{ $id: string; email: string }>;
}

/** Minimal structural view of `Teams` so tests can inject a fake (design D5). */
export interface TeamsLike {
  list(): Promise<{ teams: ReadonlyArray<{ $id: string }> }>;
}

export function sessionCookieOptions(isProduction: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function getSessionSecret(): Promise<string | null> {
  const store = await cookies();
  return store.get(AW_SESSION_COOKIE)?.value ?? null;
}

/** Server-action only: `cookies().set` is rejected inside render. */
export async function setSessionCookie(secret: string): Promise<void> {
  const store = await cookies();
  store.set(
    AW_SESSION_COOKIE,
    secret,
    sessionCookieOptions(process.env.NODE_ENV === 'production'),
  );
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(AW_SESSION_COOKIE);
}

/**
 * Resolves identity from a session secret (design D2): no secret → null;
 * Appwrite rejects it (invalid/expired) → run `onSessionInvalid` and return null.
 */
export async function resolveSessionUser(
  secret: string | null,
  deps: {
    accountFor: (secret: string) => AccountLike;
    onSessionInvalid: () => void | Promise<void>;
  },
): Promise<SessionUser | null> {
  if (secret === null) {
    return null;
  }

  try {
    const user = await deps.accountFor(secret).get();
    return { id: user.$id, email: user.email };
  } catch {
    await deps.onSessionInvalid();
    return null;
  }
}

/** Admin detection (design D2): admin iff the session's teams contain the admins team. */
export async function isTeamMember(teams: TeamsLike, teamId: string): Promise<boolean> {
  const membership = await teams.list();
  return membership.teams.some((team) => team.$id === teamId);
}

/** Per-request memoized identity (design D2): cookie secret → account.get(). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const secret = await getSessionSecret();

  return resolveSessionUser(secret, {
    accountFor: (sessionSecret) => new Account(createSessionClient(sessionSecret)),
    onSessionInvalid: async () => {
      try {
        await clearSessionCookie();
      } catch {
        // RSCs cannot mutate cookies; the browser clears the stale cookie via
        // the `/login?error=expired` middleware rule instead.
      }
    },
  });
});

/** Per-request memoized admin flag (design D2): cookie secret → teams.list(). */
export const isAdmin = cache(async (): Promise<boolean> => {
  const secret = await getSessionSecret();
  if (secret === null) {
    return false;
  }

  const teams = new Teams(createSessionClient(secret));
  return isTeamMember(teams, loadEnv().APPWRITE_ADMINS_TEAM_ID);
});

/** Why a login attempt was rejected — surfaces as `?error=` on `/login`. */
export type LoginFailureReason = 'missing' | 'credentials';

/** Injectable edges of the login flow so units run with hand-written fakes (design D5). */
export interface LoginDeps {
  createEmailPasswordSession(email: string, password: string): Promise<{ secret: string }>;
  setSessionCookie(secret: string): Promise<void>;
  onSuccess(): void;
  onFailure(reason: LoginFailureReason): void;
}

/**
 * Login flow (spec `agenda-auth`): valid credentials → cookie set + success;
 * wrong credentials → failure, NO cookie; empty fields → failure without
 * ever calling Appwrite.
 */
export async function performLogin(
  deps: LoginDeps,
  email: string,
  password: string,
): Promise<void> {
  const trimmedEmail = email.trim();

  if (!trimmedEmail || !password) {
    deps.onFailure('missing');
    return;
  }

  let secret: string;
  try {
    ({ secret } = await deps.createEmailPasswordSession(trimmedEmail, password));
  } catch {
    deps.onFailure('credentials');
    return;
  }

  await deps.setSessionCookie(secret);
  deps.onSuccess();
}

/** Injectable edges of the logout flow. */
export interface LogoutDeps {
  sessionSecret: string | null;
  deleteSession(sessionId: string): Promise<void>;
  clearSessionCookie(): Promise<void>;
  onDone(): void;
}

/**
 * Logout flow (design D2): best-effort `deleteSession('current')` when a
 * cookie exists, then ALWAYS clear the cookie — an already-expired Appwrite
 * session must not trap the user.
 */
export async function performLogout(deps: LogoutDeps): Promise<void> {
  if (deps.sessionSecret !== null) {
    try {
      await deps.deleteSession('current');
    } catch {
      // Session already invalid server-side — cookie cleanup below is enough.
    }
  }

  await deps.clearSessionCookie();
  deps.onDone();
}
