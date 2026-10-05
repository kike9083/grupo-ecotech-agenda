import { describe, expect, it, vi } from 'vitest';
import {
  LINK_TOKEN_TTL_MS,
  buildDeepLink,
  exchangeLinkToken,
  generateLinkToken,
  mintTelegramLink,
  unlinkTelegramLink,
  type TelegramLinkDoc,
  type TelegramLinkExchangeRepo,
  type TelegramLinkMintRepo,
  type TelegramLinkUnlinkRepo,
} from './telegram-link';

/**
 * Spec titles are quoted verbatim so a requirement with no formal ID is still
 * traceable (`telegram-linking` → "Link initiation" / "Bot callback validation"
 * / "Deactivated subscription on block"). Design D4 is the binding rule set:
 * mint = 32 random bytes as base64url with a 10-minute TTL, exchange = uniform
 * rejection, consumption = invalidation, same-chat idempotence.
 */

const USER = 'user-1';
const BOT_USERNAME = 'agenda_eco_bot';
const CHAT = '555000111';
const NOW = Date.parse('2026-03-04T10:00:00.000Z');
const TEN_MINUTES_MS = 10 * 60 * 1000;

type StoredDoc = TelegramLinkDoc & { userId: string };

/** In-memory repo: every method records its calls so tests can assert writes. */
class FakeRepo
  implements
    TelegramLinkExchangeRepo,
    TelegramLinkMintRepo,
    TelegramLinkUnlinkRepo
{
  readonly docs: Map<string, StoredDoc>;
  readonly saveTokenCalls: Array<{
    documentId: string;
    token: string;
    tokenExpiresAt: string;
  }> = [];
  readonly linkCalls: Array<{ documentId: string; chatId: string }> = [];
  readonly upsertCalls: string[] = [];
  readonly unlinkCalls: string[] = [];
  private autoId = 0;

  constructor(docs: StoredDoc[] = []) {
    this.docs = new Map(docs.map((doc) => [doc.$id, doc]));
  }

  docById(documentId: string): StoredDoc | undefined {
    return this.docs.get(documentId);
  }

  docByUserId(userId: string): StoredDoc | undefined {
    return [...this.docs.values()].find((doc) => doc.userId === userId);
  }

  async upsertSubscription(userId: string): Promise<StoredDoc> {
    this.upsertCalls.push(userId);
    const existing = this.docByUserId(userId);
    if (existing !== undefined) {
      return existing;
    }
    const created: StoredDoc = {
      $id: `sub-${++this.autoId}`,
      userId,
      chatId: '',
      active: false,
      token: '',
      tokenExpiresAt: '',
    };
    this.docs.set(created.$id, created);
    return created;
  }

  async saveToken(
    documentId: string,
    token: string,
    tokenExpiresAt: string,
  ): Promise<StoredDoc> {
    this.saveTokenCalls.push({ documentId, token, tokenExpiresAt });
    const doc = this.docs.get(documentId);
    if (doc === undefined) {
      throw new Error(`unknown document ${documentId}`);
    }
    doc.token = token;
    doc.tokenExpiresAt = tokenExpiresAt;
    return doc;
  }

  async findByToken(token: string): Promise<StoredDoc | null> {
    if (token === '') {
      return null;
    }
    return [...this.docs.values()].find((doc) => doc.token === token) ?? null;
  }

  async link(documentId: string, chatId: string): Promise<StoredDoc> {
    this.linkCalls.push({ documentId, chatId });
    const doc = this.docs.get(documentId);
    if (doc === undefined) {
      throw new Error(`unknown document ${documentId}`);
    }
    doc.chatId = chatId;
    doc.active = true;
    doc.token = '';
    doc.tokenExpiresAt = '';
    return doc;
  }

  async getByUser(userId: string): Promise<StoredDoc | null> {
    return this.docByUserId(userId) ?? null;
  }

  /**
   * Mirrors the storage-layer `unlink` contract (the wire truth is asserted
   * in `appwrite/telegram.test.ts`): reset the binding and any pending token,
   * leave the one-per-user `userId` alone.
   */
  async unlink(documentId: string): Promise<StoredDoc> {
    this.unlinkCalls.push(documentId);
    const doc = this.docs.get(documentId);
    if (doc === undefined) {
      throw new Error(`unknown document ${documentId}`);
    }
    doc.chatId = '';
    doc.active = false;
    doc.token = '';
    doc.tokenExpiresAt = '';
    return doc;
  }
}

function unlinkedDoc(overrides: Partial<StoredDoc> = {}): StoredDoc {
  return {
    $id: 'sub-1',
    userId: USER,
    chatId: '',
    active: false,
    token: '',
    tokenExpiresAt: '',
    ...overrides,
  };
}

async function linkAndConsume(
  repo: FakeRepo,
  token: string,
  chatId: string,
  now: number,
): Promise<{ status: string }> {
  return exchangeLinkToken({ token, chatId, repo, now });
}

describe('spec telegram-linking → Link initiation → Mint link', () => {
  it('mints 32 random bytes as a 43-character base64url token', () => {
    const token = generateLinkToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain('=');
    expect(generateLinkToken()).not.toBe(token);
  });

  it('carries a 10-minute TTL expressed as UTC ISO-8601', async () => {
    const repo = new FakeRepo();

    const minted = await mintTelegramLink({
      userId: USER,
      botUsername: BOT_USERNAME,
      repo,
      now: NOW,
    });

    expect(LINK_TOKEN_TTL_MS).toBe(TEN_MINUTES_MS);
    expect(minted.expiresAt).toBe(
      new Date(NOW + TEN_MINUTES_MS).toISOString(),
    );
    expect(minted.expiresAt.endsWith('Z')).toBe(true);
  });

  it('writes the token onto the caller document through the injected repo', async () => {
    const repo = new FakeRepo();

    const minted = await mintTelegramLink({
      userId: USER,
      botUsername: BOT_USERNAME,
      repo,
      now: NOW,
    });

    expect(repo.upsertCalls).toEqual([USER]);
    expect(repo.saveTokenCalls).toEqual([
      {
        documentId: minted.documentId,
        token: minted.token,
        tokenExpiresAt: minted.expiresAt,
      },
    ]);
    expect(repo.docByUserId(USER)).toMatchObject({
      token: minted.token,
      tokenExpiresAt: minted.expiresAt,
    });
  });

  it('re-mint overwrites so the previous deep link dies', async () => {
    const repo = new FakeRepo();
    const first = await mintTelegramLink({
      userId: USER,
      botUsername: BOT_USERNAME,
      repo,
      now: NOW,
    });

    const second = await mintTelegramLink({
      userId: USER,
      botUsername: BOT_USERNAME,
      repo,
      now: NOW + 1_000,
    });

    expect(second.token).not.toBe(first.token);
    expect(second.documentId).toBe(first.documentId);
    expect(await repo.findByToken(first.token)).toBeNull();
    expect(await repo.findByToken(second.token)).not.toBeNull();

    const rejected = await exchangeLinkToken({
      token: first.token,
      chatId: CHAT,
      repo,
      now: NOW,
    });
    expect(rejected).toEqual({ status: 'rejected' });
    expect(repo.linkCalls).toEqual([]);
  });

  it('builds the deep link from the @-less bot username', () => {
    expect(buildDeepLink(BOT_USERNAME, 'abc')).toBe(
      `https://t.me/${BOT_USERNAME}?start=abc`,
    );
    expect(buildDeepLink(`@${BOT_USERNAME}`, 'abc')).toBe(
      `https://t.me/${BOT_USERNAME}?start=abc`,
    );
  });

  it('returns the deep link the mint stored the token under', async () => {
    const repo = new FakeRepo();

    const minted = await mintTelegramLink({
      userId: USER,
      botUsername: BOT_USERNAME,
      repo,
      now: NOW,
    });

    expect(minted.deepLink).toBe(
      `https://t.me/${BOT_USERNAME}?start=${minted.token}`,
    );
  });
});

describe('spec telegram-linking → Bot callback validation → Successful exchange', () => {
  it('activates the subscription and consumes the token in one write', async () => {
    const repo = new FakeRepo([
      unlinkedDoc({ token: 'pending-token', tokenExpiresAt: new Date(NOW + 1).toISOString() }),
    ]);

    const result = await linkAndConsume(
      repo,
      'pending-token',
      CHAT,
      NOW,
    );

    expect(result).toEqual({ status: 'linked' });
    expect(repo.linkCalls).toEqual([{ documentId: 'sub-1', chatId: CHAT }]);
    expect(repo.docById('sub-1')).toMatchObject({
      chatId: CHAT,
      active: true,
      token: '',
      tokenExpiresAt: '',
    });
  });

  it('links through the injected repository only — no client, no network', async () => {
    const repo = new FakeRepo([
      unlinkedDoc({ token: 'pending-token', tokenExpiresAt: new Date(NOW + 1).toISOString() }),
    ]);

    await linkAndConsume(repo, 'pending-token', CHAT, NOW);

    expect(repo.upsertCalls).toEqual([]);
    expect(repo.saveTokenCalls).toEqual([]);
    expect(repo.linkCalls).toHaveLength(1);
  });
});

describe('spec telegram-linking → Bot callback validation → Reused token rejected', () => {
  it('rejects a consumed token and leaves the stored link unchanged', async () => {
    const doc = unlinkedDoc({
      chatId: CHAT,
      active: true,
      token: '',
      tokenExpiresAt: '',
    });
    const repo = new FakeRepo([doc]);
    const before = { ...doc };

    const result = await exchangeLinkToken({
      token: 'pending-token',
      chatId: CHAT,
      repo,
      now: NOW,
    });

    expect(result).toEqual({ status: 'rejected' });
    expect(repo.linkCalls).toEqual([]);
    expect(repo.docById('sub-1')).toEqual(before);
  });
});

describe('spec telegram-linking → Link initiation → Expired token rejected', () => {
  it('rejects a token past its 10-minute TTL without writing', async () => {
    const expiredAt = new Date(NOW - 1).toISOString();
    const doc = unlinkedDoc({ token: 'stale-token', tokenExpiresAt: expiredAt });
    const repo = new FakeRepo([doc]);
    const before = { ...doc };

    const result = await exchangeLinkToken({
      token: 'stale-token',
      chatId: CHAT,
      repo,
      now: NOW,
    });

    expect(result).toEqual({ status: 'rejected' });
    expect(repo.linkCalls).toEqual([]);
    expect(repo.docById('sub-1')).toEqual(before);
  });

  it('accepts the same token one millisecond inside the window', async () => {
    const repo = new FakeRepo([
      unlinkedDoc({
        token: 'fresh-token',
        tokenExpiresAt: new Date(NOW + 1).toISOString(),
      }),
    ]);

    const result = await exchangeLinkToken({
      token: 'fresh-token',
      chatId: CHAT,
      repo,
      now: NOW,
    });

    expect(result).toEqual({ status: 'linked' });
  });
});

describe('spec telegram-linking → Bot callback validation → uniform rejection (no oracle)', () => {
  it('returns the exact same result for unknown, expired and reused tokens', async () => {
    const unknown = new FakeRepo([unlinkedDoc()]);
    const expired = new FakeRepo([
      unlinkedDoc({
        token: 'stale-token',
        tokenExpiresAt: new Date(NOW - 1).toISOString(),
      }),
    ]);
    const reused = new FakeRepo([
      unlinkedDoc({ chatId: CHAT, active: true, token: '', tokenExpiresAt: '' }),
    ]);

    const results = await Promise.all([
      exchangeLinkToken({ token: 'never-minted', chatId: CHAT, repo: unknown, now: NOW }),
      exchangeLinkToken({ token: 'stale-token', chatId: CHAT, repo: expired, now: NOW }),
      exchangeLinkToken({ token: '', chatId: CHAT, repo: reused, now: NOW }),
    ]);

    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(results[0]).toEqual({ status: 'rejected' });
  });

  it('never queries storage for an empty token', async () => {
    const repo = new FakeRepo([unlinkedDoc({ token: '', tokenExpiresAt: '' })]);
    const findSpy = vi.spyOn(repo, 'findByToken');

    const result = await exchangeLinkToken({
      token: '',
      chatId: CHAT,
      repo,
      now: NOW,
    });

    expect(result).toEqual({ status: 'rejected' });
    expect(findSpy).not.toHaveBeenCalled();
  });
});

describe('spec telegram-linking → same-chat idempotent re-start', () => {
  it('reports already-linked without consuming the pending token', async () => {
    const doc = unlinkedDoc({
      chatId: CHAT,
      active: true,
      token: 'pending-token',
      tokenExpiresAt: new Date(NOW + 1).toISOString(),
    });
    const repo = new FakeRepo([doc]);
    const before = { ...doc };

    const result = await exchangeLinkToken({
      token: 'pending-token',
      chatId: CHAT,
      repo,
      now: NOW,
    });

    expect(result).toEqual({ status: 'already-linked' });
    expect(repo.linkCalls).toEqual([]);
    expect(repo.docById('sub-1')).toEqual(before);
  });

  it('still links when the incoming chat id differs from the stored one', async () => {
    const repo = new FakeRepo([
      unlinkedDoc({
        chatId: 'old-chat',
        active: true,
        token: 'pending-token',
        tokenExpiresAt: new Date(NOW + 1).toISOString(),
      }),
    ]);

    const result = await exchangeLinkToken({
      token: 'pending-token',
      chatId: 'new-chat',
      repo,
      now: NOW,
    });

    expect(result).toEqual({ status: 'linked' });
    expect(repo.docById('sub-1')).toMatchObject({
      chatId: 'new-chat',
      active: true,
      token: '',
    });
  });
});

describe('spec telegram-linking → Deactivated subscription on block → Re-link restores delivery', () => {
  it('reactivates a deactivated subscription that is started again', async () => {
    const repo = new FakeRepo([
      unlinkedDoc({
        chatId: CHAT,
        active: false,
        token: 'pending-token',
        tokenExpiresAt: new Date(NOW + 1).toISOString(),
      }),
    ]);

    const result = await exchangeLinkToken({
      token: 'pending-token',
      chatId: CHAT,
      repo,
      now: NOW,
    });

    expect(result).toEqual({ status: 'linked' });
    expect(repo.linkCalls).toEqual([{ documentId: 'sub-1', chatId: CHAT }]);
    expect(repo.docById('sub-1')).toMatchObject({
      chatId: CHAT,
      active: true,
      token: '',
      tokenExpiresAt: '',
    });
  });
});

describe('spec telegram-linking → Link status and unlink → Unlink', () => {
  it('resets { chatId, active, token, tokenExpiresAt } to empty/false and keeps userId', async () => {
    const repo = new FakeRepo();
    const created = await repo.upsertSubscription(USER);
    await repo.saveToken(created.$id, 'pending-token', '2026-03-04T10:10:00.000Z');
    const linked = repo.docById(created.$id);
    if (linked === undefined) throw new Error('seed failed');
    linked.chatId = CHAT;
    linked.active = true;

    const result = await unlinkTelegramLink({ userId: USER, repo });

    expect(result).toEqual({ status: 'unlinked' });
    expect(repo.unlinkCalls).toEqual([created.$id]);
    expect(repo.docByUserId(USER)).toMatchObject({
      chatId: '',
      active: false,
      token: '',
      tokenExpiresAt: '',
      userId: USER,
    });
  });

  it('never writes for a user with no subscription row', async () => {
    const repo = new FakeRepo();

    await expect(unlinkTelegramLink({ userId: 'user-ghost', repo })).resolves.toEqual({
      status: 'not-linked',
    });

    expect(repo.unlinkCalls).toEqual([]);
  });
});

describe('deep-link privacy (spec telegram-linking → Link initiation)', () => {
  it('carries only the token — no chat id, no state, no hash', () => {
    const link = buildDeepLink(`@${BOT_USERNAME}`, 'tok_only');

    expect(link).toBe(`https://t.me/${BOT_USERNAME}?start=tok_only`);
    const url = new URL(link);
    expect([...url.searchParams.keys()]).toEqual(['start']);
    expect(url.searchParams.get('start')).toBe('tok_only');
    expect(url.hash).toBe('');
  });
});
