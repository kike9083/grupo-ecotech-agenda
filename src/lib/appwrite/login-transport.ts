import { loadEnv, type ServerEnv } from '@/lib/env';

/**
 * Login transport (verify fix F1, spec `agenda-auth` → "Login").
 *
 * `POST /account/sessions/email` only returns the session `secret` in the
 * response BODY when the request is authenticated with the API key; the old
 * keyless SDK call always received `secret: ""`, so the app stored an empty
 * `aw_session` cookie and every login bounced back to `/login`.
 *
 * This module performs the session POST with raw fetch, authenticated with
 * the server API key, and reads the secret from the body — falling back to
 * the `a_session_<project>` Set-Cookie value (URL-decoded) if the body is
 * ever masked again. Pure extraction is exported for unit tests (design D5 —
 * no network in tests).
 */

/** Minimal structural view of a fetch Response so tests inject fakes (design D5). */
export interface SessionResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<SessionResponseLike>;

export interface LoginTransportDeps {
  fetchImpl?: FetchLike;
  env?: ServerEnv;
}

/**
 * Reads the session secret from an Appwrite session-creation response:
 * body `secret` first (present on API-key requests), else the
 * `a_session_<project>` Set-Cookie value (percent-decoded, `_legacy` cookie
 * ignored). Throws when neither carries a value — callers map that to the
 * credentials failure path.
 */
export function extractSessionSecret(
  body: unknown,
  setCookieHeader: string | null,
  projectId: string,
): string {
  const bodySecret = (body as { secret?: unknown } | null)?.secret;
  if (typeof bodySecret === 'string' && bodySecret !== '') {
    return bodySecret;
  }

  const cookieMatch = setCookieHeader?.match(
    new RegExp(`(?:^|[\\s;,])a_session_${projectId}=([^;,]+)`),
  );
  if (cookieMatch !== null && cookieMatch !== undefined && cookieMatch[1] !== '') {
    return decodeURIComponent(cookieMatch[1]);
  }

  throw new Error('Appwrite session response carried no session secret');
}

/**
 * Creates an email/password session server-side and resolves its secret —
 * the exact edge `performLogin` injects (`LoginDeps.createEmailPasswordSession`).
 * Rejects on non-2xx responses (wrong credentials) and on responses without
 * a usable secret.
 */
export async function createEmailPasswordSession(
  email: string,
  password: string,
  deps: LoginTransportDeps = {},
): Promise<{ secret: string }> {
  const env = deps.env ?? loadEnv();
  const doFetch: FetchLike = deps.fetchImpl ?? fetch;

  const response = await doFetch(
    `${env.APPWRITE_ENDPOINT}/account/sessions/email`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': env.APPWRITE_API_KEY,
      },
      body: JSON.stringify({ email, password }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Appwrite session creation failed with status ${response.status}`,
    );
  }

  const body = await response.json();
  const secret = extractSessionSecret(
    body,
    response.headers.get('set-cookie'),
    env.APPWRITE_PROJECT_ID,
  );
  return { secret };
}
