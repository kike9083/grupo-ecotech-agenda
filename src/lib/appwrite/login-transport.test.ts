import { describe, expect, it, vi } from 'vitest';
import type { ServerEnv } from '@/lib/env';
import {
  createEmailPasswordSession,
  extractSessionSecret,
  type FetchLike,
} from './login-transport';

const env: ServerEnv = {
  APPWRITE_ENDPOINT: 'https://aw.example/v1',
  APPWRITE_PROJECT_ID: 'proj-1',
  APPWRITE_API_KEY: 'key-123',
  APPWRITE_DATABASE_ID: 'agenda',
  APPWRITE_TASKS_COLLECTION_ID: 'tasks',
  APPWRITE_ADMINS_TEAM_ID: 'admins',
};

const rawSecret = 'eyJpZCI6InVzZXItMSJ9In0=';
const cookieSecret = 'eyJpZCI6InVzZXItMSJ9In0%3D';

/** Structural stand-in for a fetch Response (design D5 — no network in tests). */
function fakeResponse(options: {
  status?: number;
  body?: unknown;
  setCookie?: string;
}): {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
} {
  const status = options.status ?? 201;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'set-cookie'
          ? (options.setCookie ?? null)
          : null,
    },
    json: async () => options.body ?? {},
  };
}

function recordingFetch(response: ReturnType<typeof fakeResponse>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return response;
  });
  return { calls, fetchImpl };
}

describe('extractSessionSecret', () => {
  it('returns the body secret when Appwrite includes it (API-key request)', () => {
    expect(extractSessionSecret({ secret: rawSecret }, null, 'proj-1')).toBe(
      rawSecret,
    );
  });

  it('falls back to the a_session cookie and URL-decodes it when the body secret is masked', () => {
    const setCookie =
      `a_session_proj-1_legacy=${cookieSecret}; path=/, ` +
      `a_session_proj-1=${cookieSecret}; expires=Mon, 04-Oct-2027 15:41:45 GMT; httponly`;

    expect(extractSessionSecret({ secret: '' }, setCookie, 'proj-1')).toBe(
      rawSecret,
    );
  });

  it('rejects a response that only carries the legacy cookie', () => {
    expect(() =>
      extractSessionSecret(
        {},
        `a_session_proj-1_legacy=${cookieSecret}; path=/`,
        'proj-1',
      ),
    ).toThrow(/no session secret/);
  });

  it('rejects a response without any secret or cookie', () => {
    expect(() => extractSessionSecret({}, null, 'proj-1')).toThrow(
      /no session secret/,
    );
  });
});

describe('createEmailPasswordSession', () => {
  it('posts the credentials with the API key and returns the body secret', async () => {
    const { calls, fetchImpl } = recordingFetch(
      fakeResponse({ body: { secret: rawSecret } }),
    );

    const result = await createEmailPasswordSession(
      'user@example.com',
      'pw',
      { env, fetchImpl },
    );

    expect(result).toEqual({ secret: rawSecret });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://aw.example/v1/account/sessions/email',
    );
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['X-Appwrite-Project']).toBe('proj-1');
    expect(headers['X-Appwrite-Key']).toBe('key-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      email: 'user@example.com',
      password: 'pw',
    });
  });

  it('extracts the secret from the set-cookie header when the body secret is empty', async () => {
    const { fetchImpl } = recordingFetch(
      fakeResponse({
        body: { secret: '' },
        setCookie: `a_session_proj-1=${cookieSecret}; httponly`,
      }),
    );

    await expect(
      createEmailPasswordSession('user@example.com', 'pw', {
        env,
        fetchImpl,
      }),
    ).resolves.toEqual({ secret: rawSecret });
  });

  it('throws when Appwrite rejects the credentials', async () => {
    const { fetchImpl } = recordingFetch(
      fakeResponse({
        status: 401,
        body: { message: 'Invalid credentials', code: 401 },
      }),
    );

    await expect(
      createEmailPasswordSession('user@example.com', 'wrong', {
        env,
        fetchImpl,
      }),
    ).rejects.toThrow(/status 401/);
  });

  it('throws when a successful response carries no secret at all', async () => {
    const { fetchImpl } = recordingFetch(fakeResponse({ body: {} }));

    await expect(
      createEmailPasswordSession('user@example.com', 'pw', {
        env,
        fetchImpl,
      }),
    ).rejects.toThrow(/no session secret/);
  });
});
