import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AW_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  clearSessionCookie,
  getSessionSecret,
  isTeamMember,
  resolveSessionUser,
  sessionCookieOptions,
  setSessionCookie,
} from './session';

const cookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

beforeEach(() => {
  cookieStore.get.mockReset();
  cookieStore.set.mockReset();
  cookieStore.delete.mockReset();
});

describe('sessionCookieOptions', () => {
  it('builds the httpOnly, SameSite=Lax cookie from design D2 (production)', () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 86400,
    });
  });

  it('drops the Secure flag outside production', () => {
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 86400,
    });
  });

  it('exposes the contract constants', () => {
    expect(AW_SESSION_COOKIE).toBe('aw_session');
    expect(SESSION_MAX_AGE_SECONDS).toBe(86_400);
  });
});

describe('setSessionCookie', () => {
  it('writes the secret under the aw_session name with the D2 options', async () => {
    await setSessionCookie('the-secret');

    expect(cookieStore.set).toHaveBeenCalledWith(
      'aw_session',
      'the-secret',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 86_400,
      }),
    );
  });
});

describe('clearSessionCookie', () => {
  it('deletes the aw_session cookie', async () => {
    await clearSessionCookie();

    expect(cookieStore.delete).toHaveBeenCalledWith('aw_session');
  });
});

describe('getSessionSecret', () => {
  it('returns the stored secret when the cookie exists', async () => {
    cookieStore.get.mockReturnValue({ value: 'stored-secret' });

    await expect(getSessionSecret()).resolves.toBe('stored-secret');
    expect(cookieStore.get).toHaveBeenCalledWith('aw_session');
  });

  it('returns null when the cookie is absent', async () => {
    cookieStore.get.mockReturnValue(undefined);

    await expect(getSessionSecret()).resolves.toBeNull();
  });
});

describe('resolveSessionUser', () => {
  const accountFor = vi.fn();
  const onSessionInvalid = vi.fn();

  beforeEach(() => {
    accountFor.mockReset();
    onSessionInvalid.mockReset();
  });

  it('returns null without touching Appwrite when there is no secret', async () => {
    const user = await resolveSessionUser(null, { accountFor, onSessionInvalid });

    expect(user).toBeNull();
    expect(accountFor).not.toHaveBeenCalled();
    expect(onSessionInvalid).not.toHaveBeenCalled();
  });

  it('resolves id and email from the account for a valid secret', async () => {
    accountFor.mockReturnValue({
      get: vi.fn(async () => ({ $id: 'uid-1', email: 'user@example.com' })),
    });

    const user = await resolveSessionUser('valid-secret', { accountFor, onSessionInvalid });

    expect(user).toEqual({ id: 'uid-1', email: 'user@example.com' });
    expect(accountFor).toHaveBeenCalledWith('valid-secret');
    expect(onSessionInvalid).not.toHaveBeenCalled();
  });

  it('clears the session and returns null when Appwrite rejects the secret', async () => {
    accountFor.mockReturnValue({
      get: vi.fn(async () => {
        throw new Error('Invalid session');
      }),
    });

    const user = await resolveSessionUser('expired-secret', { accountFor, onSessionInvalid });

    expect(user).toBeNull();
    expect(onSessionInvalid).toHaveBeenCalledTimes(1);
  });
});

describe('isTeamMember', () => {
  const teamsWith = (...teamIds: string[]) => ({
    list: vi.fn(async () => ({ total: teamIds.length, teams: teamIds.map(($id) => ({ $id })) })),
  });

  it('is true when the membership list contains the admins team', async () => {
    await expect(isTeamMember(teamsWith('other', 'admins'), 'admins')).resolves.toBe(true);
  });

  it('is false when the user belongs to other teams only', async () => {
    await expect(isTeamMember(teamsWith('other'), 'admins')).resolves.toBe(false);
  });

  it('is false when the membership list is empty', async () => {
    await expect(isTeamMember(teamsWith(), 'admins')).resolves.toBe(false);
  });
});
