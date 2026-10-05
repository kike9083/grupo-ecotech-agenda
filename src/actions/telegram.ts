'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Databases } from 'node-appwrite';
import { createSessionClient } from '@/lib/appwrite/clients';
import { getCurrentUser, getSessionSecret } from '@/lib/appwrite/session';
import {
  TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
  createTelegramSubscriptionsApi,
} from '@/lib/appwrite/telegram';
import { loadEnv, loadReminderEnv } from '@/lib/env';
import {
  mintTelegramLink as mintLinkToken,
  unlinkTelegramLink,
} from '@/lib/telegram-link';

/**
 * Telegram linking actions (task 7.2, design D4/D8) — the same thin
 * session-guarded adapter shape as `actions/tasks.ts`:
 *
 * - identity comes from `getCurrentUser()` + `getSessionSecret()`, a stale
 *   cookie takes the shared `/login?error=expired` redirect;
 * - data access is the SESSION client, so Appwrite enforces document
 *   ownership natively (design D7 split) — the browser never talks to
 *   Appwrite and no `TELEGRAM_*` value reaches the client;
 * - `mintTelegramLink` returns `{ deepLink }` for the plain anchor the form
 *   renders; `unlinkTelegram` resets the binding and revalidates the page so
 *   the RSC re-renders in the unlinked state;
 * - mint is gated by the non-throwing reminder env: a stale tab cannot mint
 *   when the feature is unconfigured (spec `reminder-delivery` → "Disabled or
 *   unconfigured reminders").
 */

/** What the mint form renders from: the one-shot deep link, or `null`. */
export type MintLinkState = { deepLink: string | null } | null;

/**
 * Mint a link token for the signed-in user and return the deep link.
 * Re-minting overwrites the stored token, so every earlier link dies (D4).
 */
export async function mintTelegramLink(
  _prevState: MintLinkState,
  _formData: FormData,
): Promise<MintLinkState> {
  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  if (user === null || secret === null) {
    redirect('/login?error=expired');
  }

  const reminderEnv = loadReminderEnv();
  if (!reminderEnv.enabled) {
    return null;
  }

  const env = loadEnv();
  const repo = createTelegramSubscriptionsApi(
    new Databases(createSessionClient(secret)),
    {
      databaseId: env.APPWRITE_DATABASE_ID,
      collectionId: TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
    },
  );

  const minted = await mintLinkToken({
    userId: user.id,
    botUsername: reminderEnv.botUsername,
    repo,
  });

  revalidatePath('/telegram');
  return { deepLink: minted.deepLink };
}

/** Remove the caller's chat binding (spec `telegram-linking` → "Unlink"). */
export async function unlinkTelegram(): Promise<void> {
  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  if (user === null || secret === null) {
    redirect('/login?error=expired');
  }

  const env = loadEnv();
  const repo = createTelegramSubscriptionsApi(
    new Databases(createSessionClient(secret)),
    {
      databaseId: env.APPWRITE_DATABASE_ID,
      collectionId: TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
    },
  );

  await unlinkTelegramLink({ userId: user.id, repo });

  revalidatePath('/telegram');
}
