import { timingSafeEqual } from 'node:crypto';
import { Databases } from 'node-appwrite';
import { createAdminClient } from '@/lib/appwrite/clients';
import {
  TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
  createTelegramSubscriptionsApi,
} from '@/lib/appwrite/telegram';
import { loadEnv, loadReminderEnv } from '@/lib/env';
import { exchangeLinkToken, type ExchangeLinkResult } from '@/lib/telegram-link';

/**
 * Bot callback `POST /api/telegram/link` (design D4/D7).
 *
 * The middleware presence gate excludes this path, so the route self-authenticates
 * with the `x-link-secret` shared secret before anything else: a missing, wrong
 * or wrong-length secret answers 401 WITHOUT constructing an Appwrite client
 * (length-guarded `timingSafeEqual`, then nothing is written). The domain answer
 * maps to 200 (`linked` / `already-linked`) or the uniform 404 (`rejected`), so
 * the response never reveals whether a token was unknown, expired or reused.
 *
 * Tokens, chat ids and the secret are never logged (spec `telegram-linking` →
 * "Bot callback validation").
 */

/** Injected dependencies of the pure route core — the domain is a fake in tests. */
export interface LinkRouteDeps {
  /** Configured shared secret, or `null` when the feature is unconfigured. */
  linkSecret: string | null;
  /** Token exchange; the fake records calls so 401 can prove "no storage touched". */
  exchange(params: { token: string; chatId: string }): Promise<ExchangeLinkResult>;
}

/** Constant-time secret comparison that never throws on a length mismatch. */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

/** Token must be a string (an empty one still reaches the domain → uniform 404). */
function readToken(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Chat ids arrive as JSON numbers from the Bot API; coerce, then require non-empty. */
function readChatId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** Pure route core: gate → validate → domain → status map. */
export async function handleLink(
  deps: LinkRouteDeps,
  request: Request,
): Promise<Response> {
  const provided = request.headers.get('x-link-secret');
  if (
    deps.linkSecret === null ||
    provided === null ||
    !secretsMatch(provided, deps.linkSecret)
  ) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const token = readToken(record.token);
  const chatId = readChatId(record.chatId);
  if (token === null || chatId === null || chatId === '') {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const result = await deps.exchange({ token, chatId });

  if (result.status === 'rejected') {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  return Response.json({ status: result.status }, { status: 200 });
}

/**
 * Wiring (thin, untested like `api/attachments/*`): read the reminder env, then
 * build the API-key client lazily INSIDE the exchange so an unauthenticated
 * callback never constructs a client, let alone opens a connection.
 */
export async function POST(request: Request): Promise<Response> {
  const reminderEnv = loadReminderEnv();

  return handleLink(
    {
      linkSecret: reminderEnv.enabled ? reminderEnv.linkSecret : null,
      exchange: async ({ token, chatId }) => {
        const env = loadEnv();
        const api = createTelegramSubscriptionsApi(
          new Databases(createAdminClient(env)),
          {
            databaseId: env.APPWRITE_DATABASE_ID,
            collectionId: TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID,
          },
        );
        return exchangeLinkToken({ token, chatId, repo: api, now: Date.now() });
      },
    },
    request,
  );
}
