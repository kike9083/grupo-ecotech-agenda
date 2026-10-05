import { randomBytes } from 'node:crypto';

/**
 * Telegram linking domain (design D4) — pure logic plus a repository seam, no
 * Appwrite import and no network. Two deliberately narrow seams:
 *
 * - `TelegramLinkExchangeRepo` — what the callback route needs, satisfied
 *   structurally by the API-key `createTelegramSubscriptionsApi`.
 * - `TelegramLinkMintRepo` — what the mint action needs; the concrete
 *   `saveToken` lands with that wiring (phase 7).
 *
 * Rules, all from design D4: mint = 32 random bytes as base64url with a
 * 10-minute TTL that a re-mint overwrites; exchange = one write that stores the
 * chat id, activates and consumes the token (consumption IS invalidation);
 * unknown / expired / reused all collapse to the same `rejected` so the
 * response never becomes an oracle; a re-`/start` from the chat already bound
 * to the subscription is `already-linked` and writes nothing.
 */

/** Link token lifetime: 10 minutes (design D4). */
export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Entropy behind one link token: 32 bytes → 43 base64url characters. */
export const LINK_TOKEN_BYTES = 32;

/** Minimal read model of one subscription document (design D4/D7). */
export interface TelegramLinkDoc {
  $id: string;
  chatId: string;
  active: boolean;
  token: string;
  tokenExpiresAt: string;
}

/** Callback-exchange seam: find by token, then consume it in one write. */
export interface TelegramLinkExchangeRepo {
  findByToken(token: string): Promise<TelegramLinkDoc | null>;
  link(documentId: string, chatId: string): Promise<TelegramLinkDoc>;
}

/** Mint seam: the caller's one-per-user document plus a token write. */
export interface TelegramLinkMintRepo {
  upsertSubscription(userId: string): Promise<TelegramLinkDoc>;
  saveToken(
    documentId: string,
    token: string,
    tokenExpiresAt: string,
  ): Promise<TelegramLinkDoc>;
}

/**
 * Unlink seam (design D8): resolve the caller's row, then reset the binding.
 * The reset itself (`chatId ''`, `active false`, token fields `''`) lives in
 * the storage layer's `unlink`, wire-asserted in `appwrite/telegram.test.ts`;
 * this domain only orchestrates, keeping the session action three lines thin.
 */
export interface TelegramLinkUnlinkRepo {
  getByUser(userId: string): Promise<TelegramLinkDoc | null>;
  unlink(documentId: string): Promise<TelegramLinkDoc>;
}

/** A freshly minted link: what the UI shows as a one-shot deep link. */
export interface MintedTelegramLink {
  token: string;
  deepLink: string;
  expiresAt: string;
  documentId: string;
}

/** Result of a callback exchange (design D4 — no oracle: `rejected` is one value). */
export type ExchangeLinkResult =
  | { status: 'linked' }
  | { status: 'already-linked' }
  | { status: 'rejected' };

/** 32 random bytes as base64url — exactly 43 characters, never padded. */
export function generateLinkToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString('base64url');
}

/** `https://t.me/<bot>?start=<token>` with an `@`-free username (design D4). */
export function buildDeepLink(botUsername: string, token: string): string {
  const username = botUsername.startsWith('@')
    ? botUsername.slice(1)
    : botUsername;
  return `https://t.me/${username}?start=${token}`;
}

/**
 * Mint a link token for `userId`: get-or-create the subscription document,
 * generate a fresh token and overwrite whatever was pending, so every earlier
 * deep link dies as soon as a new one is minted (design D4).
 *
 * `now` is injected so the TTL is asserted against a fake clock.
 */
export async function mintTelegramLink(params: {
  userId: string;
  botUsername: string;
  repo: TelegramLinkMintRepo;
  now?: number;
}): Promise<MintedTelegramLink> {
  const now = params.now ?? Date.now();
  const doc = await params.repo.upsertSubscription(params.userId);
  const token = generateLinkToken();
  const expiresAt = new Date(now + LINK_TOKEN_TTL_MS).toISOString();

  await params.repo.saveToken(doc.$id, token, expiresAt);

  return {
    token,
    deepLink: buildDeepLink(params.botUsername, token),
    expiresAt,
    documentId: doc.$id,
  };
}

/** Result of an unlink (spec `telegram-linking` → "Unlink"). */
export type UnlinkLinkResult =
  | { status: 'unlinked' }
  | { status: 'not-linked' };

/**
 * Remove the chat binding for `userId` (spec `telegram-linking` → "Unlink",
 * design D8): resolve the caller's one-per-user row and delegate the reset to
 * the storage layer. A user with no row never writes — there is nothing to
 * unlink.
 */
export async function unlinkTelegramLink(params: {
  userId: string;
  repo: TelegramLinkUnlinkRepo;
}): Promise<UnlinkLinkResult> {
  const doc = await params.repo.getByUser(params.userId);
  if (doc === null) {
    return { status: 'not-linked' };
  }
  await params.repo.unlink(doc.$id);
  return { status: 'unlinked' };
}

/**
 * Exchange a link token for a chat binding (design D4). One write consumes the
 * token; every unusable token answers with the identical `rejected` value so
 * callers cannot tell unknown from expired from reused.
 */
export async function exchangeLinkToken(params: {
  token: string;
  chatId: string;
  repo: TelegramLinkExchangeRepo;
  now?: number;
}): Promise<ExchangeLinkResult> {
  const now = params.now ?? Date.now();

  // An empty token never queries: every unlinked document stores ''.
  if (params.token === '') {
    return { status: 'rejected' };
  }

  const doc = await params.repo.findByToken(params.token);
  if (doc === null) {
    return { status: 'rejected' };
  }

  // Idempotent re-`/start`: already active for this same chat → no write.
  if (doc.active && doc.chatId !== '' && doc.chatId === params.chatId) {
    return { status: 'already-linked' };
  }

  const expiresAt = Date.parse(doc.tokenExpiresAt);
  if (doc.tokenExpiresAt === '' || Number.isNaN(expiresAt) || now >= expiresAt) {
    return { status: 'rejected' };
  }

  await params.repo.link(doc.$id, params.chatId);
  return { status: 'linked' };
}
