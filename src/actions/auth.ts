'use server';

import { redirect } from 'next/navigation';
import { Account } from 'node-appwrite';
import { createSessionClient } from '@/lib/appwrite/clients';
import { createEmailPasswordSession } from '@/lib/appwrite/login-transport';
import {
  clearSessionCookie,
  getSessionSecret,
  performLogin,
  performLogout,
  setSessionCookie,
} from '@/lib/appwrite/session';

/**
 * Login server action (design D2): email + password → Appwrite session
 * created through the API-key-authenticated transport (verify fix F1 — the
 * keyless client used to receive `secret: ""` and stored an empty cookie)
 * → httpOnly `aw_session` cookie → redirect `/`.
 * Failures redirect back to `/login?error=...` so the page stays an RSC.
 */
export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  await performLogin(
    {
      createEmailPasswordSession,
      setSessionCookie,
      onSuccess: () => redirect('/'),
      onFailure: (reason) => redirect(`/login?error=${reason}`),
    },
    email,
    password,
  );
}

/** Logout server action (design D2): delete Appwrite session + clear cookie. */
export async function logout(): Promise<void> {
  const sessionSecret = await getSessionSecret();

  await performLogout({
    sessionSecret,
    deleteSession: async (sessionId) => {
      if (sessionSecret === null) {
        // performLogout never calls this without a cookie; keeps TS narrowing honest.
        return;
      }
      const account = new Account(createSessionClient(sessionSecret));
      await account.deleteSession(sessionId);
    },
    clearSessionCookie,
    onDone: () => redirect('/login'),
  });
}
